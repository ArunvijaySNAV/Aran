import { bigint, bigserial, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors db/migrations/0001_schemas.sql. Every identifier column holds an Aran token, never a raw value.
export const coreBanking = pgSchema("core_banking");
export const logPlatform = pgSchema("log_platform");
export const crm = pgSchema("crm");
export const vendorShare = pgSchema("vendor_share");
export const aiChat = pgSchema("ai_chat");

export const staff = coreBanking.table("staff", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").$type<Role>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Role = "kyc_officer" | "support_agent" | "compliance_officer" | "admin";

export const customers = coreBanking.table("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref").notNull(),
  nameToken: text("name_token").notNull(),
  mobileToken: text("mobile_token").notNull(),
  aadhaarToken: text("aadhaar_token").notNull(),
  panToken: text("pan_token"),
  cardToken: text("card_token"),
  status: text("status").$type<"active" | "erased">().notNull().default("active"),
  portalSecretHash: text("portal_secret_hash"),
  source: text("source").$type<"branch" | "portal">().notNull().default("branch"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = coreBanking.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  accountNo: text("account_no").notNull(),
  type: text("type").$type<"savings" | "current">().notNull().default("savings"),
  balancePaise: bigint("balance_paise", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = coreBanking.table("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  kind: text("kind").$type<"deposit" | "withdrawal" | "transfer_in" | "transfer_out">().notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  balanceAfterPaise: bigint("balance_after_paise", { mode: "number" }).notNull(),
  counterpartyAccountId: uuid("counterparty_account_id"),
  description: text("description").notNull().default(""),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kycCases = coreBanking.table("kyc_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  status: text("status").$type<"open" | "approved" | "rejected">().notNull().default("open"),
  notes: text("notes").notNull().default(""),
  openedBy: uuid("opened_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const reveals = coreBanking.table("reveals", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref").notNull(),
  field: text("field").notNull(),
  reason: text("reason").notNull(),
  staffId: uuid("staff_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const erasureRequests = coreBanking.table("erasure_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref").notNull(),
  purpose: text("purpose").notNull(),
  requestedBy: text("requested_by").notNull(),
  receipt: jsonb("receipt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appLogs = logPlatform.table("app_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  line: text("line").notNull(),
});

export const contacts = crm.table("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref").notNull(),
  nameToken: text("name_token").notNull(),
  mobileToken: text("mobile_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const crmNotes = crm.table("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull(),
  body: text("body").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanLeads = vendorShare.table("loan_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref").notNull(),
  nameToken: text("name_token").notNull(),
  mobileToken: text("mobile_token").notNull(),
  panToken: text("pan_token"),
  loanAmountPaise: bigint("loan_amount_paise", { mode: "number" }).notNull(),
  exportedBatchId: uuid("exported_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const exportBatches = vendorShare.table("export_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by"),
  rowCount: integer("row_count").notNull(),
  csv: text("csv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = aiChat.table("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerRef: text("customer_ref"),
  staffId: uuid("staff_id"),
  provider: text("provider").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const messages = aiChat.table("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
