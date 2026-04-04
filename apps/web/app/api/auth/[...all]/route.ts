import { auth } from "@/lib/auth";
import { toNodeHandler } from "better-auth/node";

export const GET = auth.handler;
export const POST = auth.handler;
