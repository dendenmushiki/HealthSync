const { processOperation } = require('../src/services/syncService');
const logger = require('../src/services/logger');

(async () => {
  try {
    const res = await processOperation({
      idempotencyKey: 'local-run-health-1',
      operation: 'CREATE',
      module: 'health',
      table: 'health_records',
      payload: { resident_id: 4, record_date: new Date().toISOString().split('T')[0], notes: 'direct test' },
      userId: 4,
      ip: '127.0.0.1',
      userAgent: 'smoke-runner'
    });
    console.log('processOperation result:', res);
  } catch (err) {
    logger.error('processOperation error', err);
  }
})();
