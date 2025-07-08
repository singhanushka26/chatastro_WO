// services/PaymentService.js - Add this new file

const crypto = require('crypto');

class PaymentService {
    constructor() {
        this.razorpayConfig = {
            keyId: process.env.RAZORPAY_KEY_ID,
            keySecret: process.env.RAZORPAY_KEY_SECRET,
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
            baseUrl: 'https://api.razorpay.com/v1'
        };
        
        // In-memory storage for orders (replace with MongoDB in production)
        this.orders = new Map();
        this.payments = new Map();
        
        // Plan configurations
        this.plans = {
            basic: { questions: 5, price: 199, name: 'Basic Plan' },
            standard: { questions: 10, price: 299, name: 'Standard Plan' },
            premium: { questions: 20, price: 399, name: 'Premium Plan' },
            report: { questions: 0, price: 999, name: 'Full Report' }
        };
    }

    // Create Razorpay order
    async createOrder(userId, planType, userDetails) {
        try {
            if (!this.plans[planType]) {
                throw new Error('Invalid plan type');
            }

            const plan = this.plans[planType];
            const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Create order data
            const orderData = {
                id: orderId,
                entity: 'order',
                amount: plan.price * 100, // Amount in paise
                currency: 'INR',
                status: 'created',
                attempts: 0,
                created_at: Math.floor(Date.now() / 1000),
                notes: {
                    userId: userId,
                    planType: planType,
                    userName: userDetails.name || 'User',
                    userMobile: userDetails.mobile || ''
                }
            };

            // In production, you would call Razorpay API here:
            /*
            const response = await fetch(`${this.razorpayConfig.baseUrl}/orders`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${this.razorpayConfig.keyId}:${this.razorpayConfig.keySecret}`).toString('base64')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: plan.price * 100,
                    currency: 'INR',
                    notes: orderData.notes
                })
            });
            const razorpayOrder = await response.json();
            */

            // For demo, we'll simulate the order
            this.orders.set(orderId, {
                ...orderData,
                userId,
                planType,
                userDetails,
                plan
            });

            console.log('💳 Payment order created:', {
                orderId,
                amount: plan.price,
                plan: plan.name,
                user: userDetails.name
            });

            return {
                success: true,
                order: {
                    id: orderId,
                    amount: plan.price * 100,
                    currency: 'INR',
                    key: this.razorpayConfig.keyId,
                    name: 'ChatAstro',
                    description: `${plan.name} - ${plan.questions} Questions`,
                    image: 'https://via.placeholder.com/200x200/4a148c/ffffff?text=✨',
                    prefill: {
                        name: userDetails.name || '',
                        contact: userDetails.mobile || '',
                        email: userDetails.email || ''
                    },
                    theme: {
                        color: '#4a148c'
                    },
                    modal: {
                        ondismiss: () => {
                            console.log('Payment cancelled');
                        }
                    }
                }
            };

        } catch (error) {
            console.error('❌ Payment order creation error:', error);
            throw new Error(`Failed to create payment order: ${error.message}`);
        }
    }

    // Verify payment
    async verifyPayment(paymentData) {
        try {
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;

            if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
                throw new Error('Missing payment verification data');
            }

            // Get order details
            const order = this.orders.get(razorpay_order_id);
            if (!order) {
                throw new Error('Order not found');
            }

            // Verify signature
            const generated_signature = crypto
                .createHmac('sha256', this.razorpayConfig.keySecret)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest('hex');

            if (generated_signature !== razorpay_signature) {
                throw new Error('Invalid payment signature');
            }

            // Create payment record
            const paymentRecord = {
                id: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: order.amount,
                currency: order.currency,
                status: 'captured',
                method: 'card', // This would come from Razorpay in real implementation
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

            console.log('✅ Payment verified successfully:', {
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: order.amount / 100,
                user: order.userDetails.name
            });

            return {
                success: true,
                payment: paymentRecord,
                order: order
            };

        } catch (error) {
            console.error('❌ Payment verification error:', error);
            throw new Error(`Payment verification failed: ${error.message}`);
        }
    }

    // Handle payment failure
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
                error: errorData.description || 'Unknown error',
                user: order?.userDetails?.name
            });

            return {
                success: false,
                message: 'Payment failed. Please try again.',
                error: errorData
            };

        } catch (error) {
            console.error('Error handling payment failure:', error);
            throw error;
        }
    }

    // Get payment status
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

    // Get user payment history
    getUserPayments(userId) {
        const userPayments = [];
        
        for (const payment of this.payments.values()) {
            if (payment.userId === userId) {
                userPayments.push({
                    id: payment.id,
                    orderId: payment.orderId,
                    amount: payment.amount / 100,
                    planType: payment.planType,
                    planName: payment.plan.name,
                    questions: payment.plan.questions,
                    status: payment.status,
                    createdAt: payment.createdAt
                });
            }
        }

        return userPayments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Validate webhook (for production)
    validateWebhook(body, signature) {
        try {
            const generated_signature = crypto
                .createHmac('sha256', this.razorpayConfig.webhookSecret)
                .update(body)
                .digest('hex');

            return generated_signature === signature;
        } catch (error) {
            console.error('Webhook validation error:', error);
            return false;
        }
    }

    // Process webhook (for production)
    async processWebhook(eventData) {
        try {
            const { event, payload } = eventData;

            switch (event) {
                case 'payment.captured':
                    await this.handlePaymentCaptured(payload.payment.entity);
                    break;
                case 'payment.failed':
                    await this.handlePaymentFailed(payload.payment.entity);
                    break;
                case 'order.paid':
                    await this.handleOrderPaid(payload.order.entity);
                    break;
                default:
                    console.log(`Unhandled webhook event: ${event}`);
            }

            return { success: true };

        } catch (error) {
            console.error('Webhook processing error:', error);
            throw error;
        }
    }

    // Get plan details
    getPlanDetails(planType) {
        return this.plans[planType] || null;
    }

    // Get all plans
    getAllPlans() {
        return Object.entries(this.plans).map(([key, plan]) => ({
            id: key,
            ...plan
        }));
    }
}

module.exports = new PaymentService();