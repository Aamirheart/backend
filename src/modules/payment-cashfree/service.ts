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

 // Replace your existing initiatePayment method with this:

async initiatePayment(context: any): Promise<any> {
    const { currency_code, amount, resource_id, customer, context: additionalContext } = context
    
    // 1. Format Amount
    const orderAmount = (amount / 100).toFixed(2)
    
    // 2. Generate a Unique Order ID
    // Appending timestamp prevents "Order already exists" errors on retry
    const externalId = `${resource_id}_${Date.now()}` 

    const payload = {
      order_id: externalId,
      order_amount: parseFloat(orderAmount),
      order_currency: currency_code.toUpperCase(),
      customer_details: {
        customer_id: customer?.id || "guest_" + resource_id,
        customer_phone: customer?.phone || "9999999999",
        customer_email: customer?.email || "test@example.com"
      },
      order_meta: {
        return_url: additionalContext?.return_url || `${process.env.STOREFRONT_URL || "http://localhost:8000"}/checkout?step=review&payment_id={order_id}`
      }
    }

    // DEBUG LOGS
    console.log("------------------------------------------------")
    console.log("🚀 Initializing Cashfree Payment...")
    console.log("API Key configured:", !!this.options_.apiKey)
    console.log("Order ID:", externalId)
    console.log("------------------------------------------------")

    try {
      const response = await axios.post(
        `${this.getBaseUrl()}/orders`, 
        payload, 
        { headers: this.getHeaders() }
      )
      
      console.log("✅ Cashfree Success! Session ID:", response.data.payment_session_id)
      
      return {
        data: {
          cf_order_id: response.data.cf_order_id,
          order_id: response.data.order_id,
          payment_session_id: response.data.payment_session_id,
          order_status: response.data.order_status,
          order_amount: response.data.order_amount,
          payment_link: response.data.payment_link,
        }
      }
    } catch (error: any) {
      // LOG THE ERROR for debugging
      console.error("❌ Cashfree Request FAILED")
      console.error("Status:", error.response?.status)
      console.error("Message:", error.response?.data?.message || error.message)
      
      // CRITICAL FIX: Do NOT throw new Error(). Return the error object instead.
      // This prevents the 500 Internal Server Error crash.
      return {
        error: error.response?.data?.message || error.message,
        code: "cashfree_init_error",
        detail: error.response?.data
      }
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>, 
    context: Record<string, unknown>
  ): Promise<any> {
    const status = await this.getPaymentStatus(paymentSessionData)
    
    return {
      status: status,
      data: paymentSessionData
    }
  }

  async getPaymentStatus(paymentSessionData: Record<string, unknown>): Promise<any> {
    const orderId = (paymentSessionData as any).order_id
    
    if (!orderId) {
      this.logger_.error("No order_id found in payment session data")
      return PaymentSessionStatus.ERROR
    }

    try {
      const response = await axios.get(
        `${this.getBaseUrl()}/orders/${orderId}`, 
        { headers: this.getHeaders() }
      )
      
      const orderStatus = response.data.order_status
      
      this.logger_.info(`Cashfree order ${orderId} status: ${orderStatus}`)
      
      switch (orderStatus) {
        case "PAID":
          return PaymentSessionStatus.AUTHORIZED
        case "ACTIVE":
          return PaymentSessionStatus.PENDING
        case "EXPIRED":
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

  async capturePayment(paymentData: Record<string, unknown>): Promise<any> {
    return paymentData
  }

  async cancelPayment(paymentData: Record<string, unknown>): Promise<any> {
    return paymentData
  }

  async deletePayment(paymentSessionData: Record<string, unknown>): Promise<any> {
    return paymentSessionData
  }

  async refundPayment(
    paymentData: Record<string, unknown>, 
    refundAmount: number
  ): Promise<any> {
    const orderId = (paymentData as any).order_id
    
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

  async retrievePayment(paymentSessionData: Record<string, unknown>): Promise<any> {
    return paymentSessionData
  }

  async getWebhookActionAndData(data: any): Promise<any> {
    const { rawData, headers } = data.data
    
    let webhookBody: any
    
    try {
      if (typeof rawData === "string") {
        webhookBody = JSON.parse(rawData)
      } else if (Buffer.isBuffer(rawData)) {
        webhookBody = JSON.parse(rawData.toString())
      } else {
        webhookBody = rawData
      }

      this.logger_.info(`Cashfree webhook received: ${webhookBody.type}`)

      const eventType = webhookBody.type
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
          this.logger_.warn(`Unhandled webhook event: ${eventType}`)
          return {
            action: "not_supported",
            data: webhookBody
          }
      }
    } catch (error: any) {
      this.logger_.error(`Webhook processing error: ${error.message}`)
      throw new Error(`Webhook processing failed: ${error.message}`)
    }
  }
}