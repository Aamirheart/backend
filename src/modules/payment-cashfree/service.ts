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

  // --- NEW HELPER: Fixes the 'data.data.data' nesting issue ---
  private flattenData(data: any): any {
    if (!data) return {};
    let clean = data;
    // Drill down until we find the actual data object containing order_id
    // This loops through any amount of nesting: data.data.data...
    while (clean.data && !clean.order_id) {
      clean = clean.data;
    }
    return clean;
  }
  // ------------------------------------------------------------

  async initiatePayment(context: any): Promise<any> {
    const { currency_code, amount, resource_id, customer, context: additionalContext } = context
    
    const validResourceId = resource_id || `sess_${Math.random().toString(36).substring(7)}`
    
    const orderAmount = (amount / 100).toFixed(2)
    const externalId = `${validResourceId}_${Date.now()}` 

    const payload = {
      order_id: externalId,
      order_amount: parseFloat(orderAmount),
      order_currency: currency_code.toUpperCase(),
      customer_details: {
        customer_id: customer?.id || "guest_" + validResourceId,
        customer_phone: customer?.phone || "9999999999",
        customer_email: customer?.email || "test@example.com"
      },
      order_meta: {
        return_url: additionalContext?.return_url || `${process.env.STOREFRONT_URL || "http://localhost:8000"}/checkout?step=review&payment_id={order_id}`
      }
    }

    console.log("🚀 Initializing Cashfree Payment...")
    console.log(`Payload Order ID: ${externalId}`)

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/orders`, 
        payload, 
        { headers: this.getHeaders() }
      )
      
      console.log("✅ Cashfree Success! Returning Data...")
      const responseData = {
        cf_order_id: response.data.cf_order_id,
        order_id: response.data.order_id,
        payment_session_id: response.data.payment_session_id,
        order_status: response.data.order_status,
        payment_link: response.data.payment_link,
      }
      
      // Medusa expects { data: ... } return from initiatePayment
      return {
        data: responseData
      }
    } catch (error: any) {
      console.error("❌ Cashfree Init Failed:", error.response?.data?.message || error.message)
      throw new Error(`Cashfree Init Failed: ${error.response?.data?.message || error.message}`)
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>, 
    context: Record<string, unknown>
  ): Promise<any> {
    // 1. CLEANUP: Fix any existing nesting before processing
    const flatData = this.flattenData(paymentSessionData);
    
    console.log("🔍 Authorize Payment - Clean Data:", JSON.stringify(flatData, null, 2));

    if (!flatData.order_id) {
      console.error("❌ Fatal: No order_id found in payment session data.");
      return {
        status: PaymentSessionStatus.ERROR,
        data: flatData // Return clean data to prevent further corruption
      }
    }

    const status = await this.getPaymentStatus(flatData);
    
    return {
      status: status,
      data: flatData // Save CLEAN data back to DB
    }
  }

  async getPaymentStatus(paymentSessionData: Record<string, unknown>): Promise<any> {
    // Ensure we are working with clean data
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
      const delay = 2000 // 2 seconds

      // Polling Loop
      while (attempts < maxAttempts) {
        attempts++
        try {
            const response = await axios.get(
              `${this.getBaseUrl()}/orders/${orderId}`, 
              { headers: this.getHeaders() }
            )
            orderStatus = response.data.order_status
            this.logger_.info(`Poll Attempt ${attempts}/${maxAttempts}: Order ${orderId} is ${orderStatus}`)

            // If terminal state reached, stop polling
            if (orderStatus === "PAID" || orderStatus === "EXPIRED" || orderStatus === "USER_DROPPED") {
              break
            }
        } catch (e: any) {
            this.logger_.error(`Poll Request Failed: ${e.message}`)
        }

        // Wait before next attempt if still ACTIVE
        if (orderStatus === "ACTIVE" && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }

      switch (orderStatus) {
        case "PAID":
          return PaymentSessionStatus.AUTHORIZED
        case "ACTIVE":
          // If still active after 10s, return PENDING. Frontend will handle the retry.
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

      this.logger_.info(`Refund initiated for order ${orderId}: ${response.data.cf_refund_id}`)

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
        this.logger_.info("⚠️ Cashfree Test/Verification Webhook received. Returning OK.")
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
      this.logger_.info(`Cashfree webhook received: ${eventType}`)

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
      this.logger_.error(`Webhook processing error: ${error.message}`)
      return { action: "not_supported" }
    }
  }
}