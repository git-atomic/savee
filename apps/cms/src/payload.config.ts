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

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

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
  collections: [Users, Sources, Runs, Blocks],

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
      connectionString: process.env.DATABASE_URI || "",
    },
    migrationDir: "./src/migrations",
  }),

  // Media handling
  sharp,

  // No additional plugins needed
  plugins: [],

  // CORS settings for production
  cors: [
    "http://localhost:3000",
    "https://your-domain.com", // Replace with actual domain
  ],

  // Disable features not needed
  localization: false,

  // File upload limits
  upload: {
    limits: {
      fileSize: 5000000, // 5MB
    },
  },
});
