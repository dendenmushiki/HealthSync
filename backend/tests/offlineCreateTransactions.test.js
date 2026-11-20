const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const routeFiles = [
  { name: 'residentRoutes', method: 'post' },
  { name: 'healthRecordRoutes', method: 'post' },
  { name: 'childHealthRoutes', method: 'post' },
  { name: 'operationTimbangRoutes', method: 'post' },
  { name: 'adolescentBMIRoutes', method: 'post' },
  { name: 'seniorCitizenRoutes', method: 'post' },
  { name: 'residentMedicalRecordRoutes', method: 'post' },
  { name: 'reportRoutes', method: 'put' },
];

test('all supported direct offline create routes use atomic idempotency', () => {
  for (const { name: routeName, method: createMethod } of routeFiles) {
    const registrations = [];
    const idempotencyMiddlewares = [];
    const routePath = `\\routes\\${routeName}.js`;
    const router = Object.fromEntries(['get', 'post', 'put', 'delete', 'use'].map((method) => [
      method,
      (...args) => registrations.push({ method, args }),
    ]));
    const noop = () => {};

    Module._load = function load(request, parent, isMain) {
      if (parent?.filename?.endsWith(routePath)) {
        if (request === 'express') return { Router: () => router };
        if (request === '../middleware/authenticate') return noop;
        if (request === '../middleware/authorize') return () => noop;
        if (request === '../middleware/idempotency') {
          return (...args) => {
            const middleware = () => {};
            middleware.options = args[2];
            idempotencyMiddlewares.push(middleware);
            return middleware;
          };
        }
        if (request === '../services/residentSchemaService') return { ensureResidentSchema: noop };
        if (request === '../middleware/profilePhotoUpload') return { uploadProfilePhoto: noop };
        if (request.startsWith('../')) return new Proxy({}, { get: () => noop });
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    const routePathForRequire = `../src/routes/${routeName}`;
    delete require.cache[require.resolve(routePathForRequire)];
    try {
      require(routePathForRequire);
      const atomicMiddleware = idempotencyMiddlewares.find((middleware) => middleware.options?.atomic === true);
      const createRoute = registrations.find(({ method, args }) => (
        method === createMethod && args.includes(atomicMiddleware)
      ));
      assert.ok(atomicMiddleware, `${routeName} must configure atomic idempotency`);
      assert.ok(createRoute, `${routeName} create route must use atomic idempotency`);
    } finally {
      delete require.cache[require.resolve(routePathForRequire)];
      Module._load = originalLoad;
    }
  }
});
