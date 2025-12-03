// src/auth.ts
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import {openAPI} from "better-auth/plugins"
import "dotenv/config"
import { sendMail } from "../utils/sendEmail.js";

export const auth = betterAuth({
  // Configure the PostgreSQL connection
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
    // optionally, you can set search_path if you use a custom schema
    // e.g. options: "-c search_path=auth"
  }),

  plugins: [openAPI()],

  // Enable the authentication methods you want
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true, 
    sendResetPassword: async ({user, url, token}, request) => {
      await sendMail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password: ${url}`,
      });
    },
    onPasswordReset: async ({ user }, request) => {
      // your logic here
      console.log(`Password for user ${user.email} has been reset.`);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    async sendVerificationEmail(data) {
      await sendMail({
        to: data.user.email,
        subject: "Activate your account",
        text: `Hi ${data.user.name}! You recently joined Mero Health. Lets activate your account by clicking the following link: ${data.url}`,
      });
    },
  },
  trustedOrigins: [
    "http://localhost:3000"
  ]
  
});
