const axios = require('axios');

const API = process.env.API_URL || 'http://localhost:5000/api/sync';
const TOKEN = process.env.TEST_TOKEN;
const logger = require('../src/services/logger');

if (!TOKEN) {
  logger.error('Set TEST_TOKEN environment variable before running this script.');
  process.exit(1);
}

async function run() {
  try {
    console.log('Sending valid create to residents (specialized handler)...');
    const resp = await axios.post(API, {
      operation: 'CREATE',
      module: 'residents',
      table: 'residents',
      // use residents CREATE which is handled specially by the server
      payload: { first_name: 'Smoke', last_name: 'Tester', birthdate: '1990-01-01', sex: 'male', sitio: 'Capitol', contact_no: '09123456789' }
    }, { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Idempotency-Key': 'smoke-valid-1' } });
    console.log('Valid response:', resp.data);
  } catch (err) {
    logger.error('Valid request failed', err.response ? err.response.data : err.message);
  }

  try {
    console.log('Sending invalid create to operation_timbang (weight too large)...');
    const resp2 = await axios.post(API, {
      operation: 'CREATE',
      module: 'timbang',
      table: 'operation_timbang',
      // use allowed column names: `weight_kg`, `measurement_cm`, `date_recorded`
      payload: { resident_id: 1, date_recorded: '2026-08-29', weight_kg: 10000, measurement_cm: 170 }
    }, { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Idempotency-Key': 'smoke-invalid-1' } });
    console.log('Invalid response (unexpected):', resp2.data);
  } catch (err) {
    logger.error('Invalid request result (expected)', err.response ? err.response.data : err.message);
  }

  try {
    console.log('Sending health_records create including resident_id (should be allowed)...');
    const resp3 = await axios.post(API, {
      operation: 'CREATE',
      module: 'health',
      table: 'health_records',
      payload: { resident_id: 4, record_date: new Date().toISOString().split('T')[0], notes: 'smoke test for health_records with resident_id' }
    }, { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Idempotency-Key': 'smoke-health-1' } });
    console.log('Health records response:', resp3.data);
  } catch (err) {
    logger.error('Health records request failed', err.response ? err.response.data : err.message);
  }
}

run();
