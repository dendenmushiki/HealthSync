# HealthSync API

## Profile photo storage

Uploaded profile and resident photos are stored under `uploads/profiles`, and
the database keeps their generated `/uploads/profiles/...` path. Express serves
these files through both `/uploads` and `/api/uploads`; when deploying the
backend in a container or on an ephemeral host, mount `uploads` to persistent
storage so photos remain available after restarts or deployments.

## Resident medical forms migration

Apply the schema changes to the configured MySQL database before using the new
resident medical forms:

```sh
npm run migrate:medical-records
```

The migration adds the resident address field and creates the clinical, child,
maternal, and immunization record tables. Each table keeps its form-specific
fields in a JSON column and has a cascading foreign key to `residents`.

## Resident address selector

The resident form bundles a local copy of Philippine Statistics Authority
Geographic Code (PSGC) locations at
`../frontend/src/data/philippineLocations.json`. The backend uses its matching
copy at `src/data/philippineLocations.json` to validate submitted location
codes. The dropdowns and address validation do not call an external API and
work without a network connection.

Resident API handlers add the nullable location-code columns to an existing
`residents` table when first used. To apply those schema changes explicitly
beforehand, run:

```sh
npm run migrate:residents
```

The migration and automatic schema check preserve existing free-text addresses.

## FHSIS report remarks

The FHSIS report stores period-specific indicator remarks in a dedicated table.
Apply the additive migration before opening the report:

```sh
mysql -u <database-user> -p <database-name> < src/scripts/migrateFhsisRemarks.sql
```

Set `BARANGAY_NAME` and `MUNICIPALITY_NAME` in the backend environment to print
the reporting jurisdiction. If they are not configured, the report labels the
jurisdiction as not configured rather than inferring it from resident records.

## Account security and preferences

The account settings APIs create the per-user preferences and login history
tables and add the `token_version` column to `users` when first used. To prepare
these changes explicitly, run:

```sh
npm run migrate:account-security
```

New passwords and changed passwords must be at least 18 characters and include
an uppercase letter, a number, and a symbol. Existing password hashes remain
valid until the account owner changes their password. Session version changes
invalidate previously issued JWTs.

## User management and temporary passwords

Apply the additive user-account migration before deploying the user-management
screen and forced first-login password change:

```sh
mysql -u <database-user> -p <database-name> < src/scripts/migrateUserManagement.sql
```

The migration checks each column and index before adding it. Existing accounts
retain `must_change_password = 0`; existing password hashes and columns are not
altered. Resolve any duplicate usernames before adding the unique username
index, then rerun the migration. The backend also creates missing additive
account columns on demand, following the existing schema-initialization pattern.

New users and password resets receive server-generated temporary passwords by
default. They expire after 72 hours unless `TEMP_PASSWORD_EXPIRY_HOURS` is set
to a value from 1 to 720. A temporary password can only be viewed in the
one-time creation/reset response. Login is limited to 10 attempts per 15
minutes per IP; five consecutive incorrect passwords lock an account for 15
minutes. Password-reset attempts are limited to five per 15 minutes per IP.

When `must_change_password` is set, authenticated API routes return
`PASSWORD_CHANGE_REQUIRED`; only password change and logout remain available.

## Offline PIN and device authorization

Prepare offline PIN and enrolled-device tracking before deploying the PIN lock
flow:

```sh
npm run migrate:offline-security
```

The migration adds a first-login setup field to `users` and creates
`offline_devices`, which stores a per-device PIN hash. Existing accounts are not forced to change their
password or enroll a PIN. New accounts must set their own six-digit PIN after
changing their temporary password. Each authorized device has its own bcrypt-protected
PIN verifier; the PIN itself is only sent over the authenticated TLS connection
during enrollment.

The first device for an account is enrolled at password login. Additional
devices remain pending until an administrator approves them through the
offline-device user endpoints. Device IDs are scoped to accounts. Revoked
device records are retained. Offline grants do not expire and are not API
credentials; explicit signout clears the local grant. The application checks
device status through authenticated API requests and a device-key proof when
connectivity returns. A disconnected device cannot learn of remote revocation
until it reconnects. A device identity stored in the browser profile is not
hardware attestation, and PIN-only local key wrapping has lower protection
against an attacker who can copy and inspect the browser profile. Local PIN
attempts are rate-limited by the app but local storage can be modified by a
sufficiently capable device owner.

Existing expiring grants are not promoted to persistent grants. Users with an
older grant must reconnect and sign in once so the device-bound authorization
and PIN wrapper can be established. Existing encrypted offline records are
preserved during that upgrade.

## Audit log migration and operation

Apply the additive audit-log migration before deploying the redesigned Audit
Logs page:

```sh
mysql -u <database-user> -p <database-name> < src/scripts/migrateAuditLogs.sql
```

The migration adds nullable actor/target, result/severity, metadata, source
fields, and indexes only when missing. It leaves existing event rows and JSON
untouched. It makes the legacy `user_id` column nullable (without changing
existing values) so a failed sign-in with an unknown username can have a null
actor while retaining the existing foreign key. For legacy `LOGIN_FAILED`
events, `user_id` is treated as the attempted account, not the actor.
Timestamps are interpreted with an explicit `+08:00` MySQL driver timezone
and displayed in `Asia/Manila`; SQL sorting uses the stored timestamp and ID.

All audit writes go through `logAudit` (the older `writeAudit` name remains a
compatibility alias). It redacts credential-like field names and bearer/JWT or
bcrypt values, records the request IP and user agent through request context,
and stores explicit actor and target fields. Set `TRUST_PROXY=1` only when
HealthSync is behind a trusted reverse proxy; otherwise the backend uses the
socket-derived client address. Never grant the application database account
`UPDATE` or `DELETE` on `audit_logs`; the HTTP API exposes only read and export
operations. No retention job deletes audit events. The inspected development
database contained 333 events at the time of the audit; no archival policy is
currently configured.
Overnight sign-in insights default to 10 PM–5 AM and can be configured with
`AUDIT_UNUSUAL_HOURS_START` and `AUDIT_UNUSUAL_HOURS_END` (integer hours 0–23).

The authenticated BHW API is rooted at
`/api/resident-medical-records/:residentId/:recordType`, where `recordType` is
`clinical`, `child`, `maternal`, or `immunization`. GET returns records for the
resident; POST creates one; PUT updates a record by ID; DELETE removes a record
by ID. Write requests contain a `record_data` JSON object.
