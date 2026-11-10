// Load before application modules: .env.local contains production credentials.
// Verification must never inherit that database, even through an incomplete mock.
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:9/dda_offline'
process.env.DDA_OFFLINE_VERIFY = '1'
