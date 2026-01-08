import { 
  AbstractPaymentProvider, 
  PaymentSessionStatus
} from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import Razorpay from "razorpay"
import crypto from "crypto"

type Options = {
  keyId: string
  keySecret: string
  webhookSecret: string
}

export default class RazorpayPaymentProvider extends AbstractPaymentProvider<Options> {
  static identifier = "razorpay"
  protected options_: Options
  protected logger_: Logger
  protected razorpay_: Razorpay

  constructor(container: { logger: Logger }, options: Options) {
    super(container, options)
    this.options_ = options
    this.logger_ = container.logger

    this.razorpay_ = new Razorpay({
      key_id: this.options_.keyId,
      key_secret: this.options_.keySecret,
    })
  }

  async initiatePayment(context: any): Promise<any> {
    const { currency_code, amount, resource_id, customer } = context
    
    const orderData = {
      amount: amount, 
      currency: currency_code.toUpperCase(),
      receipt: resource_id || `receipt_${Date.now()}`,
      notes: {
        customer_id: customer?.id,
        resource_id: resource_id,
      },
    }

    try {
      const order = await this.razorpay_.orders.create(orderData)
      
      return {
        id: order.id, 
        amount: order.amount,
        currency: order.currency,
        notes: order.notes,
        status: "created"
      }
    } catch (error: any) {
      this.logger_.error(`Razorpay Order Creation Failed: ${error.message}`)
      throw new Error(`Razorpay Order Creation Failed: ${error.message}`)
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>, 
    context: Record<string, unknown>
  ): Promise<any> {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = paymentSessionData

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return {
        status: PaymentSessionStatus.PENDING,
        data: paymentSessionData,
      }
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", this.options_.keySecret)
      .update(body.toString())
      .digest("hex")

    if (expectedSignature === razorpay_signature) {
      return {
        status: PaymentSessionStatus.AUTHORIZED,
        data: {
          ...paymentSessionData,
          status: "authorized"
        }
      }
    } else {
      return {
        status: PaymentSessionStatus.ERROR,
        data: {
          ...paymentSessionData,
          error: "Signature verification failed"
        }
      }
    }
  }

  async getPaymentStatus(paymentSessionData: Record<string, unknown>): Promise<any> {
    const { razorpay_payment_id, status } = paymentSessionData
    
    if (status === "authorized") return PaymentSessionStatus.AUTHORIZED
    if (status === "captured") return PaymentSessionStatus.CAPTURED
    if (!razorpay_payment_id) return PaymentSessionStatus.PENDING

    try {
      const payment = await this.razorpay_.payments.fetch(razorpay_payment_id as string)

      switch (payment.status) {
        case "captured":
          return PaymentSessionStatus.CAPTURED
        case "authorized":
          return PaymentSessionStatus.AUTHORIZED 
        case "failed":
          return PaymentSessionStatus.ERROR
        default:
          return PaymentSessionStatus.PENDING
      }
    } catch (error) {
      return PaymentSessionStatus.ERROR
    }
  }

  // FIXED: Return type is now Promise<any> to avoid import error
  async getWebhookActionAndData(data: any): Promise<any> {
    try {
      const { rawData, headers } = data
      
      const signature = headers["x-razorpay-signature"]
      if (!this.options_.webhookSecret || !signature) {
         return { action: "not_supported" }
      }

      const expectedSignature = crypto
        .createHmac("sha256", this.options_.webhookSecret)
        .update(rawData)
        .digest("hex")

      if (signature !== expectedSignature) {
        this.logger_.error("Razorpay webhook signature verification failed")
        return { action: "not_supported" }
      }

      const event = JSON.parse(rawData.toString())
      const { event: eventType, payload } = event

      switch (eventType) {
        case "payment.captured":
          return {
            action: "captured",
            data: {
              resource_id: payload.payment.entity.notes.resource_id,
              amount: payload.payment.entity.amount,
            },
          }
        
        case "payment.failed":
          return {
            action: "failed",
            data: {
               resource_id: payload.payment.entity.notes.resource_id,
            },
          }

        default:
          return { action: "not_supported" }
      }

    } catch (error: any) {
      this.logger_.error(`Razorpay webhook error: ${error.message}`)
      return { action: "not_supported" }
    }
  }

  async capturePayment(paymentData: Record<string, unknown>): Promise<any> {
    const { razorpay_payment_id, amount } = paymentData
    try {
       const capture = await this.razorpay_.payments.capture(razorpay_payment_id as string, amount as number, "INR")
       return { ...paymentData, status: "captured", capture_id: capture.id }
    } catch (e: any) {
       this.logger_.error(`Capture failed: ${e.message}`)
       return paymentData
    }
  }

  async refundPayment(
    paymentData: Record<string, unknown>, 
    refundAmount: number
  ): Promise<any> {
     const { razorpay_payment_id } = paymentData
     try {
       const refund = await this.razorpay_.payments.refund(razorpay_payment_id as string, {
         amount: refundAmount
       })
       return { ...paymentData, refund_id: refund.id }
     } catch(e: any) {
        this.logger_.error(`Razorpay Refund Failed: ${e.message}`)
        throw e
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

  async cancelPayment(paymentData: Record<string, unknown>): Promise<any> {
    return paymentData
  }
}