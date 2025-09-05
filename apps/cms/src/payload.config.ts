import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";

import { Users } from "./collections/Users";
import { Sources } from "./collections/Sources";
import { Runs } from "./collections/Runs";
import { Blocks } from "./collections/Blocks";
import { SaveeUsers } from "./collections/SaveeUsers";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const corsOrigins = (
  process.env.CORS_ORIGINS ||
  ["https://visualcms.vercel.app", "http://localhost:3000"].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default buildConfig({
  // Admin Configuration
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: "- Savee Scraper CMS",
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      views: {
        "/engine": {
          Component: "@/components/EngineView",
          path: "/engine",
        },
      },
    },
  },

  // Collections - Clean & Organized
  collections: [Users, Sources, Runs, Blocks, SaveeUsers],

  // No globals needed for this application
  globals: [],

  // Editor
  editor: lexicalEditor(),

  // Security
  secret: process.env.PAYLOAD_SECRET || "",

  // TypeScript
  typescript: {
    outputFile: path.resolve(dirname, "payload-types.ts"),
  },

  // Database - Clean Production Setup
  db: postgresAdapter({
    pool: {
      connectionString:
        process.env.DATABASE_URL || process.env.DATABASE_URI || "",
    },
    migrationDir: "./src/migrations",
    // Prevent Payload from managing external tables
    push: false,
  }),

  // Media handling
  sharp,

  // No additional plugins needed
  plugins: [],

  // CORS settings (env-driven to support multiple frontends/subdomains)
  cors: corsOrigins,

  // Disable features not needed
  localization: false,

  // File upload limits
  upload: {
    limits: {
      fileSize: 5000000, // 5MB
    },
  },
  onInit: async (payload) => {
    try {
      const db = (payload.db as any).pool;
      // Ensure new filterable columns exist on blocks
      await db.query(
        `ALTER TABLE blocks 
         ADD COLUMN IF NOT EXISTS origin_text TEXT,
         ADD COLUMN IF NOT EXISTS saved_by_usernames TEXT`
      );
      // Backfill for all blocks once
      await db.query(
        `UPDATE blocks b
         SET origin_text = COALESCE(origin_text,
           CASE WHEN s.source_type = 'user' THEN s.username ELSE s.source_type END),
           saved_by_usernames = COALESCE(saved_by_usernames, sub.usernames)
         FROM sources s
         LEFT JOIN (
           SELECT ub.block_id, string_agg(u.username, ',') AS usernames
           FROM user_blocks ub
           JOIN savee_users u ON u.id = ub.user_id
           GROUP BY ub.block_id
         ) AS sub ON sub.block_id = b.id
         WHERE b.source_id = s.id`
      );
    } catch (e) {
      console.warn("[onInit] Failed to ensure blocks columns:", e);
    }
  },
});
