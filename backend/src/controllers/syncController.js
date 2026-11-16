const { processOperation, findIdempotency } = require('../services/syncService');
const logger = require('../services/logger');

const handleSync = async (req, res) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (!idempotencyKey) return res.status(400).json({ success: false, message: 'Missing idempotency key' });

    const { operation, module, table, payload } = req.body;
    if (!operation || !table) return res.status(400).json({ success: false, message: 'Invalid sync payload' });

    // If key already processed, return stored response
    const existing = await findIdempotency(idempotencyKey);
    if (existing) {
      return res.json({ success: true, data: { cached: true, record: existing } });
    }

    const userId = req.user ? req.user.user_id : null;
    const ip = req.ip;
    const userAgent = req.get('User-Agent');
    const result = await processOperation({ idempotencyKey, operation, module, table, payload, userId, ip, userAgent });
    if (result.fromCache) {
      return res.json({ success: true, data: { cached: true, record: result.record } });
    }
    return res.json({ success: true, data: result.response });
  } catch (err) {
    if (err && err.name === 'ValidationError') {
      return res.status(400).json({ success: false, errors: err.errors });
    }
    logger.error('Sync error', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
};

module.exports = { handleSync };
