
const dotenv = require('dotenv');

dotenv.config();

const app = require('./src/app');
const { initializeFromDatabase } = require('./src/services/syncService');
const logger = require('./src/services/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Initialize offline synchronization data.
    try {
      await initializeFromDatabase(process.env.DB_NAME);
      logger.info('Sync service initialized successfully.');
    } catch (err) {
      // Keep the existing behavior: sync initialization failure
      // should not prevent the API from starting.
      logger.error('Sync service initialization error', err);
    }

    // Start the Express server using Render's assigned port.
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`HealthSync backend running on port ${PORT}`);
    });

    server.on('error', (err) => {
      logger.error('HealthSync server startup error', err);
      process.exit(1);
    });

  } catch (err) {
    logger.error('Failed to start HealthSync backend', err);
    process.exit(1);
  }
};

startServer();
