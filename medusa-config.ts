const { loadEnv, defineConfig } = require('@medusajs/framework/utils')
const path = require("path") 

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      host: "0.0.0.0",
      storeCors: process.env.STORE_CORS,
      adminCors: process.env.ADMIN_CORS,
      authCors: process.env.AUTH_CORS,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
 modules: [
  {
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/auth-emailpass",
            id: "emailpass",
            options: {
              // You can add password policies here later
            }
          }
        ]
      }
    },
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/payment-cashfree",
            id: "cashfree",
            options: {
              apiKey: process.env.CASHFREE_API_KEY,
              secretKey: process.env.CASHFREE_SECRET_KEY,
              env: "sandbox", 
            },
          },
        ],
      },
    },
  ],
})