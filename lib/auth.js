// src/auth.ts
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { bearer, openAPI } from "better-auth/plugins";
import "dotenv/config";
import { sendMail } from "../utils/sendEmail.js";
import { expo } from "@better-auth/expo";

export const auth = betterAuth({
  // Configure the PostgreSQL connection
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
    // optionally, you can set search_path if you use a custom schema
    // e.g. options: "-c search_path=auth"
    
  }),

  tables: {
    user: "users",               // 👈 IMPORTANT
    session: "sessions",
    account: "accounts",
    verificationToken: "verification_tokens",
  },

  	user: {
		additionalFields: {
			role: {
				type: "string",
				required: false,
				defaultValue: "user",
				input: false, // don't allow user to set role
			},
      date_of_birth: {
        type: "date",
        required: false,
        defaultValue: "",
      },
      gender: {
        type: "string",
        required: false,
        defaultValue: ""
      },
      height: {
        type: "number",
        required: false,
        defaultValue: 0
      },
      weight: {
        type: "number",
        required: false,
        defaultValue: 0
      },
      phone: {
        type: "string",
        required: false,
        defaultValue: ""
      },
      avatar_url: {
        type: "string",
        required: false,
        defaultValue: ""
      },
      blood_type: {
        type: "string",
        required: false,
        defaultValue: ""
      }

    },
  },

  plugins: [openAPI(), expo(), bearer()],

  // Enable the authentication methods you want
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url, token }, request) => {
      await sendMail({
        to: user.email,
        subject: "Reset your password",
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p>Hello ${user.name},</p>
        <p>You requested to reset your password. Click the button below to reset it:</p>
        <a href="${url}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 16px 0;">Reset Password</a>
        <p>If you didn't request this, please ignore this email.</p>
        <p>This link will expire in 24 hours.</p>
        <p>Best regards,<br>Mero Health Team</p>
      </div>
    `,
        text: `Hello ${user.name},\n\nYou requested to reset your password. Click this link to reset it: ${url}\n\nIf you didn't request this, please ignore this email.\n\nThis link will expire in 24 hours.\n\nBest regards,\nMero Health Team`,
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
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Verify Your Email</h2>
        <p>Hello ${data.user.name},</p>
        <p>Thank you for signing up! Please verify your email address by clicking the button below:</p>
        <a href="${data.url}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 16px 0;">Verify Email</a>
        <p>If you didn't create an account, please ignore this email.</p>
        <p>This link will expire in 24 hours.</p>
        <p>Best regards,<br>Mero Health Team</p>
      </div>
    `,
        text: `Hello ${data.user.name},\n\nThank you for signing up! Please verify your email address by clicking this link: ${data.url}\n\nIf you didn't create an account, please ignore this email.\n\nThis link will expire in 24 hours.\n\nBest regards,\nMero Health Team`,
      });
    },
  },
  
  trustedOrigins: process.env.NODE_ENV === "development"
  ? ["exp://192.168.*", "exp://172.16.9.168", "http://localhost:3000", "https://merohealth-web.vercel.app", "merohealthmobile://"]
  : ["https://merohealth-web.vercel.app"]

});
