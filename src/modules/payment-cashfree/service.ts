import { 
  AbstractPaymentProvider, 
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import axios from "axios"

type Options = {
  apiKey: string
  secretKey: string
  env: "sandbox" | "production"
}

export default class CashfreePaymentProvider extends AbstractPaymentProvider<Options> {
  static identifier = "cashfree"
  protected options_: Options
  protected logger_: Logger

  constructor(container: { logger: Logger }, options: Options) {
    super(container, options)
    this.options_ = options
    this.logger_ = container.logger
  }

  private getBaseUrl(): string {
    return this.options_.env === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg"
  }

  private getHeaders() {
    return {
      "x-client-id": this.options_.apiKey,
      "x-client-secret": this.options_.secretKey,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    }
  }

  private flattenData(data: any): any {
    if (!data) return {};
    let clean = data;
    while (clean.data && !clean.order_id) {
      clean = clean.data;
    }
    return clean;
  }

  async initiatePayment(context: any): Promise<any> {
    const { currency_code, amount, resource_id, customer, context: additionalContext } = context
    
    const validResourceId = resource_id || `sess_${Math.random().toString(36).substring(7)}`
    const orderAmount = (amount / 100).toFixed(2)
    
    // 🔥 KEY FIX: Use a clean order_id format that Cashfree accepts
    const cashfreeOrderId = `order_${validResourceId}_${Date.now()}`

    const payload = {
      order_id: cashfreeOrderId,
      order_amount: parseFloat(orderAmount),
      order_currency: currency_code.toUpperCase(),
      customer_details: {
        customer_id: customer?.id || "guest_" + validResourceId,
        customer_phone: customer?.phone || "9999999999",
        customer_email: customer?.email || "test@example.com"
      },
      order_meta: {
        return_url: additionalContext?.return_url || 
          `${process.env.STOREFRONT_URL || "http://localhost:8000"}/checkout?step=review&payment_id={order_id}`
      }
    }

    console.log("🚀 Initializing Cashfree Payment with Order ID:", cashfreeOrderId)

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/orders`, 
        payload, 
        { headers: this.getHeaders() }
      )
      
      console.log("✅ Cashfree Response:", JSON.stringify(response.data, null, 2))
      
      // 🔥 CRITICAL: Store both IDs - order_id is what SDK needs
      const responseData = {
        order_id: response.data.order_id,           // This is what SDK expects
        cf_order_id: response.data.cf_order_id,     // Cashfree's internal ID
        payment_session_id: response.data.payment_session_id,
        order_status: response.data.order_status,
        payment_link: response.data.payment_link,
      }
      
      return {
        data: responseData
      }
    } catch (error: any) {
      console.error("❌ Cashfree Init Failed:", error.response?.data || error.message)
      throw new Error(`Cashfree Init Failed: ${error.response?.data?.message || error.message}`)
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>, 
    context: Record<string, unknown>
  ): Promise<any> {
    const flatData = this.flattenData(paymentSessionData);
    
    console.log("🔍 Authorize Payment - Data:", JSON.stringify(flatData, null, 2));

    if (!flatData.order_id) {
      console.error("❌ No order_id found in payment session data.");
      return {
        status: PaymentSessionStatus.ERROR,
        data: flatData
      }
    }

    const status = await this.getPaymentStatus(flatData);
    
    return {
      status: status,
      data: flatData
    }
  }

  async getPaymentStatus(paymentSessionData: Record<string, unknown>): Promise<any> {
    const data = this.flattenData(paymentSessionData);
    const orderId = data.order_id;
    
    if (!orderId) {
      this.logger_.error("No order_id found in payment session data")
      return PaymentSessionStatus.ERROR
    }

    try {
      let orderStatus = "ACTIVE"
      let attempts = 0
      const maxAttempts = 5 
      const delay = 2000

      while (attempts < maxAttempts) {
        attempts++
        try {
            const response = await axios.get(
              `${this.getBaseUrl()}/orders/${orderId}`, 
              { headers: this.getHeaders() }
            )
            orderStatus = response.data.order_status
            this.logger_.info(`Poll ${attempts}/${maxAttempts}: Order ${orderId} is ${orderStatus}`)

            if (orderStatus === "PAID" || orderStatus === "EXPIRED" || orderStatus === "USER_DROPPED") {
              break
            }
        } catch (e: any) {
            this.logger_.error(`Poll Failed: ${e.message}`)
        }

        if (orderStatus === "ACTIVE" && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      switch (orderStatus) {
        case "PAID":
          return PaymentSessionStatus.AUTHORIZED
        case "ACTIVE":
          return PaymentSessionStatus.PENDING
        case "EXPIRED":
        case "USER_DROPPED":
          return PaymentSessionStatus.CANCELED
        default:
          return PaymentSessionStatus.ERROR
      }
    } catch (error: any) {
      this.logger_.error(`Error fetching payment status: ${error.message}`)
      return PaymentSessionStatus.ERROR
    }
  }

  async updatePayment(context: any): Promise<any> {
    return this.initiatePayment(context)
  }
  
  async deletePayment(paymentSessionData: Record<string, unknown>): Promise<any> {
    return paymentSessionData
  }

  async retrievePayment(paymentSessionData: Record<string, unknown>): Promise<any> {
    return paymentSessionData
  }

  async capturePayment(paymentData: Record<string, unknown>): Promise<any> {
    return paymentData
  }

  async cancelPayment(paymentData: Record<string, unknown>): Promise<any> {
    return paymentData
  }

  async refundPayment(
    paymentData: Record<string, unknown>, 
    refundAmount: number
  ): Promise<any> {
    const data = this.flattenData(paymentData);
    const orderId = data.order_id;
    
    if (!orderId) {
      throw new Error("No order_id found for refund")
    }

    const refundAmountDecimal = (refundAmount / 100).toFixed(2)

    const payload = {
      refund_amount: parseFloat(refundAmountDecimal),
      refund_id: `refund_${orderId}_${Date.now()}`,
      refund_note: "Customer refund request"
    }

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/orders/${orderId}/refunds`,
        payload,
        { headers: this.getHeaders() }
      )

      this.logger_.info(`Refund initiated: ${response.data.cf_refund_id}`)

      return {
        cf_refund_id: response.data.cf_refund_id,
        refund_status: response.data.refund_status,
        refund_amount: response.data.refund_amount,
      }
    } catch (error: any) {
      this.logger_.error(`Refund failed: ${error.response?.data?.message || error.message}`)
      throw new Error(`Refund failed: ${error.response?.data?.message || error.message}`)
    }
  }

  async getWebhookActionAndData(data: any): Promise<any> {
    try {
      if (!data || !data.data || !data.data.rawData) {
        this.logger_.info("⚠️ Cashfree Test Webhook")
        return { action: "not_supported" }
      }

      const { rawData } = data.data
      
      let webhookBody: any
      if (typeof rawData === "string") {
        webhookBody = JSON.parse(rawData)
      } else if (Buffer.isBuffer(rawData)) {
        webhookBody = JSON.parse(rawData.toString())
      } else {
        webhookBody = rawData
      }

      const eventType = webhookBody.type
      this.logger_.info(`Cashfree webhook: ${eventType}`)

      const orderData = webhookBody.data?.order || {}

      switch (eventType) {
        case "PAYMENT_SUCCESS_WEBHOOK":
          return {
            action: "authorized",
            data: {
              cf_order_id: orderData.cf_order_id,
              order_id: orderData.order_id,
              order_status: orderData.order_status,
              order_amount: orderData.order_amount,
              transaction_id: orderData.cf_payment_id,
              payment_method: orderData.payment_method,
              payment_time: orderData.payment_time,
            }
          }

        case "PAYMENT_FAILED_WEBHOOK":
          return {
            action: "failed",
            data: {
              cf_order_id: orderData.cf_order_id,
              order_id: orderData.order_id,
              error_message: orderData.error_message,
            }
          }

        case "PAYMENT_USER_DROPPED_WEBHOOK":
          return {
            action: "canceled",
            data: {
              cf_order_id: orderData.cf_order_id,
              order_id: orderData.order_id,
            }
          }

        default:
          return {
            action: "not_supported",
            data: webhookBody
          }
      }
    } catch (error: any) {
      this.logger_.error(`Webhook error: ${error.message}`)
      return { action: "not_supported" }
    }
  }
}