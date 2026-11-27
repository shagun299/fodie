# FoodieHub

FoodieHub is a responsive food-ordering application with a separate HTML/CSS/JavaScript frontend and a Node.js/Express API.

## Live frontend

GitHub Pages: https://shagun299.github.io/fodie/

**Important:** GitHub Pages publishes static files only. It cannot run Node.js, SQLite, customer authentication or payment webhooks. The frontend remains in demo/local-browser mode until you deploy the API and configure its URL.

## Project layout

- `fit check/` — standalone FitTrack application (`index.html`, `style.css`, `app.js`).

- \`index.html\` — page structure, sections, forms and dialogs.
- \`assets/css/styles.css\` — responsive styling, themes and component states.
- \`assets/js/app.js\` — menu, search, favourites, cart, customisation, checkout, order tracking and dashboards.
- \`assets/js/config.js\` — base URL for the separately hosted API.
- \`data/menu.json\` — starter menu catalogue.
- \`server/index.js\` — Express application, checkout, payment verification, order tracking and analytics.
- \`server/production.js\` — customer/admin sessions, password hashing, address book, menu management, stock, coupons, audit logs, webhooks and refunds.
- \`tests/production.test.js\` — backend integration and security tests.

## Local development

Requirements: Node.js 20 or newer.

\`\`\`bash
npm install
npm run check
npm test
npm start
\`\`\`

Open http://localhost:3000. SQLite is initialized automatically under \`server/data\` unless \`DATA_DIR\` is set.

## Production deployment

Use a Node.js web-service host such as Render or Railway. Do not deploy the API on GitHub Pages.

Suggested Render settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | \`npm install\` |
| Start command | \`npm start\` |
| Health check | \`/api/health\` |
| Persistent disk mount | \`/var/data\` |
| Instance count | One instance for the SQLite deployment |

Add the variables from \`.env.example\` in the hosting provider's secret/environment settings. At minimum:

1. \`NODE_ENV=production\`
2. \`DATA_DIR=/var/data\` and attach a persistent disk at that exact path.
3. \`ALLOWED_ORIGINS=https://shagun299.github.io\` (include any custom frontend domain too).
4. \`JWT_SECRET\` as a unique random secret of at least 32 characters.
5. \`FIREBASE_PROJECT_ID=foodiehub-43023\` so the API can verify Firebase Authentication ID tokens used by Google/email customer sign-in.
6. \`ADMIN_EMAIL\` and \`ADMIN_PASSWORD_HASH\`. Run \`node scripts/hash-password.js\` locally to create the scrypt hash. Do not put the plain password in GitHub.
7. Configure \`ADMIN_API_KEY\` as a long random secret when using the admin-key form in the frontend. Keep it only in hosting environment variables, never in GitHub or frontend config.

The API deliberately refuses to start in production without a strong \`JWT_SECRET\` and an explicit \`ALLOWED_ORIGINS\` list.

### Connect the GitHub Pages frontend

After the API service is deployed and its health URL works, edit \`assets/js/config.js\` and set the public API base URL:

\`\`\`js
window.FOODIEHUB_API_URL = "https://YOUR-API-HOST";
\`\`\`

This URL is public and is not a secret. Never place database credentials, JWT signing secrets, Razorpay secrets or admin keys in \`config.js\`. Commit the change to \`main\`; GitHub Actions will publish the updated static frontend.

### Razorpay setup

1. Start with Razorpay Test Mode credentials.
2. Add \`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\` and \`RAZORPAY_WEBHOOK_SECRET\` as server environment variables.
3. In the Razorpay dashboard, add the webhook URL \`https://YOUR-API-HOST/api/payments/webhook\`.
4. Subscribe to \`payment.captured\`, \`payment.failed\` and \`order.paid\`.
5. Test successful payments, failed payments, duplicate webhook delivery, cancellations and refunds before switching to Live Mode.

The server calculates the order price, validates coupon eligibility, reserves tracked stock, creates the Razorpay order, verifies payment signatures and reconciles webhook events. Refunds are initiated from the protected admin refund endpoint.

## Backend capabilities

### Customer accounts

- \`POST /api/auth/register\` and \`POST /api/auth/login\`
- \`GET /api/auth/me\`, \`PATCH /api/auth/me\`, \`POST /api/auth/logout\`
- \`GET /api/auth/orders\`
- \`GET /api/auth/addresses\`, \`POST /api/auth/addresses\`, \`DELETE /api/auth/addresses/:id\`

Email/password accounts can use the API's Node.js scrypt sessions. The customer UI also supports Firebase email/password and Google sign-in; the browser attaches a Firebase ID token to API requests, and the backend verifies its RS256 signature, issuer, audience, expiry and Firebase UID. New signed-in COD orders are linked to that UID for account order history. Guest checkout and phone-based order tracking remain supported.

### Menu, stock and coupons

- Public menu and category endpoints return only active dishes and include availability/stock metadata.
- Admin menu APIs can add, edit, disable and archive dishes.
- Admin inventory APIs can enable quantity tracking, update quantities and prevent checkout from overselling tracked dishes. A \`null\` quantity means stock tracking is not enabled for that dish.
- Coupon rules live in SQLite, not only in frontend JavaScript. Admin APIs can create, edit, activate and disable coupon codes. Usage limits are claimed inside the order transaction and released for failed/cancelled orders.

### Orders and payments

- Server-side price, customisation, coupon, tax and delivery calculations.
- Atomic order creation and inventory reservations.
- Customer order history when checkout includes a valid customer bearer token.
- Guest order tracking using order number and checkout phone.
- Razorpay order creation and payment signature/provider verification.
- Signed webhook verification, event de-duplication and payment failure cleanup.
- Protected admin order status changes and Razorpay refunds.

### Admin APIs

The legacy \`ADMIN_API_KEY\` bearer/header access remains supported. A password-based admin session can also be created through \`POST /api/admin/auth/login\` using \`ADMIN_EMAIL\` and the scrypt \`ADMIN_PASSWORD_HASH\`.

Protected endpoints include:

- \`GET /api/admin/orders\`, \`GET /api/admin/orders/:orderNumber\`, \`PATCH /api/admin/orders/:orderNumber\`
- \`POST /api/admin/orders/:orderNumber/refund\`
- \`GET/POST/PATCH/DELETE /api/admin/menu...\`
- \`GET/PATCH /api/admin/inventory...\`
- \`GET/POST/PATCH/DELETE /api/admin/coupons...\`
- \`GET /api/admin/customers\`, \`GET /api/admin/newsletter\`, \`GET /api/admin/audit-logs\`
- \`GET /api/admin/analytics\`

## Database and scaling notes

The current app uses SQLite with WAL mode and foreign keys. For a small, single-instance restaurant deployment, this is suitable only when the database directory is mounted on persistent storage and backups are configured. Keep the service to one application instance; do not run multiple API replicas against the same SQLite file. For multi-instance/high-volume operation, migrate the data layer to managed PostgreSQL before scaling.

Back up the persistent database regularly, test restoration, monitor health/error logs and set a retention policy for customer data. Protect the hosting account with MFA and rotate admin/JWT/payment secrets.

## Production readiness boundaries

The backend code and API are implemented, but a production launch still requires your hosting account, persistent disk, environment secrets, Razorpay merchant approval/webhook setup and end-to-end live tests. I cannot activate those account-side resources from a GitHub commit alone.

The customer sign-in interface and API bearer-token integration are now present. Firebase email verification and password-reset flows depend on the Firebase project settings and delivery configuration. The current Render service is on the Free plan and its SQLite file is on ephemeral storage, not a persistent disk. Orders and accounts stored only in that SQLite database can be lost when the service restarts, is replaced or redeploys. Do not treat this database as durable for real customer orders. Before a production launch, attach persistent storage on a paid service or migrate SQLite to an external managed database, then configure backups and test restoration. Razorpay setup and end-to-end payment tests are a separate remaining step.
