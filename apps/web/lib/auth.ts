import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@click-deploy/database";
import * as schema from "@click-deploy/database";
import { randomUUID } from "crypto";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
            user: schema.users,
            session: schema.sessions,
            account: schema.accounts,
            verification: schema.verifications,
        }
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
        enabled: true,
    },
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID || "",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
            enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
            scope: ["read:user", "user:email", "repo", "admin:repo_hook"],
        },
    },
    user: {
        additionalFields: {
            organizationId: {
                type: "string",
                required: false,
            },
            role: {
                type: "string",
                required: false,
                defaultValue: "owner",
            }
        }
    },
    session: {
        expiresIn: 60 * 60 * 24 * 30, // 30 days
        updateAge: 60 * 60 * 24, // update session every 24 hours
    },
    advanced: {
        cookiePrefix: "click-deploy",
        database: {
            // Users table has UUID id with gen_random_uuid() default,
            // so we return false to let PostgreSQL generate it.
            // Sessions, accounts, and verifications use text IDs,
            // so we generate UUIDs for those.
            generateId: ({ model }: { model: string }) => {
                if (model === "user") return false as unknown as string;
                return randomUUID();
            },
        },
    },
});
