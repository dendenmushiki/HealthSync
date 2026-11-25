
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const dotenv = require('dotenv');

const authRoutes = require('./routes/authRoutes');
const residentRoutes = require('./routes/residentRoutes');
const healthRecordRoutes = require('./routes/healthRecordRoutes');
const operationTimbangRoutes = require('./routes/operationTimbangRoutes');
const adolescentBMIRoutes = require('./routes/adolescentBMIRoutes');
const adultBMIRoutes = require('./routes/adultBMIRoutes');
const seniorCitizenRoutes = require('./routes/seniorCitizenRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditRoutes = require('./routes/auditRoutes');
const userRoutes = require('./routes/userRoutes');
const adminSettingsRoutes = require('./routes/adminSettingsRoutes');
const syncRoutes = require('./routes/syncRoutes');
const auditContext = require('./middleware/auditContext');
const childHealthRoutes = require('./routes/childHealthRoutes');
const residentMedicalRecordRoutes = require('./routes/residentMedicalRecordRoutes');
const nutritionRecordRoutes = require('./routes/nutritionRecordRoutes');

const {
  notFoundHandler,
  errorHandler
} = require('./middleware/errorHandler');

dotenv.config();

const app = express();

// Trust Render's reverse proxy when configured.
if (['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase())) {
  app.set('trust proxy', 1);
}

// Security middleware.
app.use(helmet());

// Request body parsing.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration for local development and production.
const allowedOrigins = [
  'http://localhost:3000',
  process.env.CLIENT_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests without an Origin header.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
  ],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Idempotency-Key',
    'X-HealthSync-Offline-Sync',
    'X-HealthSync-Client-Created-At'
  ]
}));

// Audit context middleware.
app.use(auditContext);

// Uploaded files configuration.
const allowCrossOriginImages = (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

const uploadDirectory = path.resolve(__dirname, '../uploads');

app.use(
  '/uploads',
  allowCrossOriginImages,
  express.static(uploadDirectory)
);

app.use(
  '/api/uploads',
  allowCrossOriginImages,
  express.static(uploadDirectory)
);

// API routes.
app.use('/api/auth', authRoutes);
app.use('/api/residents', residentRoutes);
app.use('/api/health-records', healthRecordRoutes);
app.use('/api/child-health', childHealthRoutes);
app.use('/api/resident-medical-records', residentMedicalRecordRoutes);
app.use('/api/operation-timbang', operationTimbangRoutes);
app.use('/api/adolescent-bmi', adolescentBMIRoutes);
app.use('/api/adult-bmi', adultBMIRoutes);
app.use('/api/nutrition', nutritionRecordRoutes);
app.use('/api/senior-citizens', seniorCitizenRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin-settings', adminSettingsRoutes);
app.use('/api/sync', syncRoutes);

// Health check endpoint.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is healthy'
  });
});

// Error handling.
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

