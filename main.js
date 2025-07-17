function startChat() {
    document.getElementById('welcomeScreen').classList.add('hidden');
    document.getElementById('chatMessages').classList.remove('hidden');
    document.getElementById('inputContainer').classList.add('hidden');
    showBirthForm();
}

async function startPayment(planType, userId, userDetails) {
  const response = await fetch('/api/payment/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planType, userId, userDetails })
  });
  const result = await response.json();

  if (!result.success) {
    alert('Failed to create order');
    return;
  }

  const options = {
    ...result.order,
    handler: async function (response) {
      // Verify payment
      await fetch('/api/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      }).then(r => r.json()).then(data => {
        alert('✅ Payment Successful!');
      }).catch(err => {
        alert('❌ Payment Verification Failed');
      });
    },
    modal: {
      ondismiss: async function () {
        // Optional: Handle user closing Razorpay popup
        await fetch('/api/payment-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: result.order.id,
            errorData: { description: 'User closed payment popup' }
          })
        });
      }
    }
  };

  const razorpay = new Razorpay(options);
  razorpay.open();
}
