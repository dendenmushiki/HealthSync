
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const sslEnabled = String(process.env.DB_SSL || '').toLowerCase() === 'true';

// Validate required production database settings.
if (isProduction) {
  const requiredVariables = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const missingVariables = requiredVariables.filter(
    (variable) => !process.env[variable]
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required database environment variables: ${missingVariables.join(', ')}`
    );
  }

  if (!sslEnabled) {
    throw new Error('DB_SSL must be set to true in production.');
  }
}

// Configure TLS for TiDB Cloud.
let sslConfig;

if (sslEnabled) {
  const caPath = process.env.DB_SSL_CA_PATH;

  if (!caPath) {
    throw new Error(
      'DB_SSL_CA_PATH is required when DB_SSL is enabled.'
    );
  }

  const resolvedCaPath = path.resolve(caPath);

  if (!fs.existsSync(resolvedCaPath)) {
    throw new Error(
      `TiDB CA certificate not found: ${resolvedCaPath}`
    );
  }

  sslConfig = {
    ca: fs.readFileSync(resolvedCaPath, 'utf8'),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  };
}

// Create MySQL/TiDB connection pool.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT
    ? Number(process.env.DB_PORT)
    : 3306,

  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'healthsync_db',

  ssl: sslConfig,

  timezone: '+08:00',

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  dateStrings: ['DATE']
});

module.exports = pool;
