const express = require('express');
const fetch = require('node-fetch');
const twilio = require('twilio');

const app = express();
app.use(express.json());

// Load sensitive info from environment variables
const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  MY_PHONE_NUMBER,
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID,
  EMAILJS_PUBLIC_KEY,
} = process.env;

// Map product SKUs to download links
const productDownloadLinks = {
  "shotgun_pack": "https://drive.google.com/file/d/1nOgDQ-iEs1c72LbkSUSJlL1oQKVsl-JR/view?usp=sharing",
  "smg_pack": "https://drive.google.com/file/d/1SW1wPdZs9roOPNLr9TK4_EtkxFnN6fi0/view?usp=sharing",
  "ar_pack": "https://drive.google.com/file/d/1KPgM3cPxHTALnXOpU0Oj2jTPQw-aSDI5/view?usp=sharing",
  "bullet_drop_pack": "https://drive.google.com/file/d/1mWrNFCwl-iKNREQ3ttK6CQEoxmp6sMHY/view?usp=sharing",
  "fortnite_optimizer_pack": "https://drive.google.com/file/d/17Hi9xyhWXMdfrDzyyj15jV9azJsexov_/view?usp=sharing",
  "build_place_pack": "https://drive.google.com/file/d/1JtFPiApQIbFi9oTc-tOpMvhCG9GzbQNT/view?usp=sharing",
};

// Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Track used keys in memory
const usedKeys = new Set();

// Fetch all keys from GitHub
async function fetchAllKeys() {
  const res = await fetch('https://raw.githubusercontent.com/Malik-2-Wavy/Pc-Keys/refs/heads/main/Keys', {
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to fetch keys list');
  const text = await res.text();
  return text.split('\n').map(k => k.trim()).filter(Boolean);
}

// Get a unique unused key for Masterclass or other products
async function getUniqueKey(isMasterclass) {
  const allKeys = await fetchAllKeys();
  const filteredKeys = isMasterclass
    ? allKeys.filter(k => k.includes('Masterclass'))
    : allKeys.filter(k => !k.includes('Masterclass'));

  const unusedKey = filteredKeys.find(k => !usedKeys.has(k));
  if (!unusedKey) throw new Error(`No unused keys available for ${isMasterclass ? 'Masterclass' : 'other products'}`);

  usedKeys.add(unusedKey);
  return unusedKey;
}

// PayPal: Get Access Token
async function getPaypalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json();
  return data.access_token;
}

// PayPal: Verify Order
async function verifyPaypalOrder(orderId) {
  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json();
  if (data.status === 'COMPLETED') return data;
  throw new Error('Order not completed');
}

// Send Email using EmailJS REST API
async function sendEmailJSEmail(to_email, name, purchase_key, download_link) {
  const payload = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: {
      to_email,
      name,
      purchase_key,
      download_link,
    }
  };

  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`EmailJS failed: ${response.status} ${errText}`);
  }
  return response.json();
}

app.post('/verify-paypal-payment', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ status: 'error', message: 'Missing orderId' });

    const orderData = await verifyPaypalOrder(orderId);

    const payerName = `${orderData.payer.name.given_name} ${orderData.payer.name.surname}`;
    const payerEmail = orderData.payer.email_address;
    const purchaseAmount = orderData.purchase_units[0].amount.value;
    const purchaseCurrency = orderData.purchase_units[0].amount.currency_code;

    const items = orderData.purchase_units[0].items || [];
    const purchasedSkus = items.map(i => i.sku.toLowerCase());

    const isMasterclass = purchasedSkus.some(sku => sku.includes('masterclass')) ||
      items.some(i => i.name.toLowerCase().includes('masterclass'));

    const purchaseKey = await getUniqueKey(isMasterclass);

    const downloadLinks = !isMasterclass
      ? purchasedSkus.map(sku => productDownloadLinks[sku]).filter(Boolean)
      : [];

    const emailDownloadLinks = isMasterclass
      ? 'No download required. Use the key below to access your Masterclass.'
      : downloadLinks.join('\n');

    await client.messages.create({
      body: `New payment received! Payer: ${payerName}, Amount: ${purchaseAmount} ${purchaseCurrency}`,
      from: TWILIO_PHONE_NUMBER,
      to: MY_PHONE_NUMBER,
    });

    await sendEmailJSEmail(payerEmail, payerName, purchaseKey, emailDownloadLinks);

    res.json({ status: 'success', message: 'Payment verified, SMS and email sent' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Verification failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
