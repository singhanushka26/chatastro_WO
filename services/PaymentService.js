require('dotenv').config();

const crypto = require('crypto');
const Razorpay = require('razorpay');

class PaymentService {
  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    this.razorpayConfig = {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    };

    // Temporary in-memory storage (replace with DB in production)
    this.orders = new Map();
    this.payments = new Map();

    this.plans = {
      basic: { questions: 5, price: 199, name: 'Basic Plan' },
      standard: { questions: 10, price: 299, name: 'Standard Plan' },
      premium: { questions: 20, price: 399, name: 'Premium Plan' },
      report: { questions: 0, price: 999, name: 'Full Report' }
    };
  }

  // ✅ Create Razorpay Order
  async createOrder(userId, planType, userDetails) {
    try {
      const plan = this.plans[planType];
      if (!plan) throw new Error('Invalid plan type');

      const razorpayOrder = await this.razorpay.orders.create({
        amount: plan.price * 100, // paise
        currency: 'INR',
        receipt: `receipt_${Date.now()}`,
        notes: {
          userId,
          planType,
          userName: userDetails.name || 'User',
          userMobile: userDetails.mobile || ''
        }
      });

      const orderData = {
        ...razorpayOrder,
        userId,
        planType,
        plan,
        userDetails,
        status: 'created'
      };

      this.orders.set(razorpayOrder.id, orderData);

      return {
        success: true,
        order: {
          id: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          key: this.razorpayConfig.keyId,
          name: 'ChatAstro',
          description: `${plan.questions} Questions - ${planType} Plan`,
          image: 'https://via.placeholder.com/200x200/4a148c/ffffff?text=✨',
          prefill: {
            name: userDetails.name || '',
            email: userDetails.email || '',
            contact: userDetails.mobile || ''
          },
          theme: { color: '#4a148c' }
        }
      };

    } catch (error) {
        console.error('❌ Razorpay order creation failed:', error); // Full object
        console.log('🧪 Debug Info:', {
            key_id: this.razorpayConfig.keyId,
            key_secret_present: !!this.razorpayConfig.keySecret,
            plan: this.plans[planType],
            userDetails
        });
        throw error; 
    }
    console.log("🔐 Razorpay Key Loaded:", process.env.RAZORPAY_KEY_ID);
    console.log("🔐 Razorpay Secret Loaded:", !!process.env.RAZORPAY_KEY_SECRET); // true or false

  }
  

  // ✅ Verify Payment Signature
  async verifyPayment(paymentData) {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new Error('Missing payment verification data');
      }

      const order = this.orders.get(razorpay_order_id);
      if (!order) throw new Error('Order not found');

      const generated_signature = crypto
        .createHmac('sha256', this.razorpayConfig.keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generated_signature !== razorpay_signature) {
        throw new Error('Invalid payment signature');
      }

      const paymentRecord = {
        id: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: order.amount,
        currency: order.currency,
        status: 'captured',
        method: 'card', // Can enhance with Razorpay webhook
        userId: order.userId,
        planType: order.planType,
        plan: order.plan,
        createdAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString()
      };

      this.payments.set(razorpay_payment_id, paymentRecord);

      // Update order status
      order.status = 'paid';
      order.paymentId = razorpay_payment_id;
      this.orders.set(razorpay_order_id, order);

      console.log('✅ Payment verified:', {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      });

      return {
        success: true,
        payment: paymentRecord,
        order: order
      };

    } catch (error) {
      console.error('❌ Payment verification failed:', error);
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  // ✅ Handle Payment Failure
  async handlePaymentFailure(orderId, errorData) {
    try {
      const order = this.orders.get(orderId);
      if (order) {
        order.status = 'failed';
        order.error = errorData;
        order.failedAt = new Date().toISOString();
        this.orders.set(orderId, order);
      }

      console.log('❌ Payment failed:', {
        orderId,
        error: errorData.description || 'Unknown error'
      });

      return {
        success: false,
        message: 'Payment failed. Please try again.',
        error: errorData
      };

    } catch (error) {
      console.error('❌ Error in handlePaymentFailure:', error);
      throw error;
    }
  }

  // ✅ Get Payment Status by Order ID
  getPaymentStatus(orderId) {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const payment = order.paymentId ? this.payments.get(order.paymentId) : null;

    return {
      order: {
        id: order.id,
        amount: order.amount,
        status: order.status,
        createdAt: order.created_at
      },
      payment: payment ? {
        id: payment.id,
        status: payment.status,
        method: payment.method,
        verifiedAt: payment.verifiedAt
      } : null
    };
  }

  // ✅ User Payment History
  getUserPayments(userId) {
    return [...this.payments.values()]
      .filter(p => p.userId === userId)
      .map(p => ({
        id: p.id,
        orderId: p.orderId,
        amount: p.amount / 100,
        planType: p.planType,
        planName: p.plan.name,
        questions: p.plan.questions,
        status: p.status,
        createdAt: p.createdAt
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // ✅ Webhook Validator
  validateWebhook(body, signature) {
    try {
      const generated_signature = crypto
        .createHmac('sha256', this.razorpayConfig.webhookSecret)
        .update(body)
        .digest('hex');

      return generated_signature === signature;
    } catch (error) {
      console.error('Webhook validation failed:', error);
      return false;
    }
  }

  // ✅ Process Webhook Event (optional)
  async processWebhook(eventData) {
    const { event, payload } = eventData;
    try {
      switch (event) {
        case 'payment.captured':
          console.log('🔔 Webhook: payment.captured');
          break;
        case 'payment.failed':
          console.log('🔔 Webhook: payment.failed');
          break;
        case 'order.paid':
          console.log('🔔 Webhook: order.paid');
          break;
        default:
          console.log('ℹ️ Webhook ignored:', event);
      }
      return { success: true };
    } catch (err) {
      console.error('Webhook processing error:', err);
      throw err;
    }
  }

  getPlanDetails(planType) {
    return this.plans[planType] || null;
  }

  getAllPlans() {
    return Object.entries(this.plans).map(([id, plan]) => ({ id, ...plan }));
  }
}

module.exports = new PaymentService();
