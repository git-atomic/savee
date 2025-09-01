import type { CollectionConfig } from "payload";

export const Blocks: CollectionConfig = {
  slug: "blocks",
  admin: {
    useAsTitle: "title",
    defaultColumns: [
      "preview",
      "title",
      "media_type", // Match database column name
      "origin", // Computed: home | pop | username
      "saved_by",
      "status",
      "source",
      "run",
      "createdAt",
    ],
    description: "Individual scraped content blocks from Savee.it",
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    // Preview (admin-only UI field)
    {
      name: "preview",
      type: "ui",
      label: "Preview",
      admin: {
        components: {
          Cell: "@/components/BlockPreviewCell",
        },
      },
    },
    // Saved by usernames
    {
      name: "saved_by",
      type: "ui",
      label: "Saved By",
      admin: {
        components: {
          Cell: "@/components/BlockUsersCell",
        },
      },
    },
    // Origin (computed from source.sourceType / username)
    {
      name: "origin",
      type: "ui",
      label: "Savee User / Origin",
      admin: {
        description: "home | pop | username (computed)",
        components: {
          Cell: "@/components/BlockOriginCell",
        },
      },
    },
    // External Reference
    {
      name: "external_id", // Match database column name
      type: "text",
      required: true,
      unique: true,
      label: "External ID",
      admin: {
        description: "Unique identifier from Savee.it",
      },
    },

    // Relationships (source info available via relationships)
    {
      name: "source",
      type: "relationship",
      relationTo: "sources",
      required: true,
      label: "Source",
    },
    {
      name: "run",
      type: "relationship",
      relationTo: "runs",
      required: true,
      label: "Run",
    },
    {
      name: "savee_user",
      type: "relationship",
      relationTo: "savee_users",
      label: "Savee User",
      admin: {
        description: "SaveeUser profile for user content organization",
        position: "sidebar",
      },
    },
    

    // Content Info
    {
      name: "url",
      type: "text",
      required: true,
      label: "Content URL",
    },
    {
      name: "title",
      type: "text",
      label: "Title",
    },
    {
      name: "description",
      type: "textarea",
      label: "Description",
    },

    // Media Information
    {
      name: "media_type", // Match database column name
      type: "select",
      label: "Media Type",
      options: [
        { label: "Image", value: "image" },
        { label: "Video", value: "video" },
        { label: "GIF", value: "gif" },
        { label: "Unknown", value: "unknown" },
      ],
    },
    {
      name: "image_url", // Match database column name
      type: "text",
      label: "Image URL",
    },
    {
      name: "video_url", // Match database column name
      type: "text",
      label: "Video URL",
    },
    {
      name: "thumbnail_url", // Match database column name
      type: "text",
      label: "Thumbnail URL",
    },

    // Status and Processing
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "pending",
      label: "Status",
      options: [
        { label: "Pending", value: "pending" },
        { label: "Fetched", value: "fetched" },
        { label: "Scraped", value: "scraped" },
        { label: "Uploaded", value: "uploaded" },
        { label: "Error", value: "error" },
      ],
    },

    // Comprehensive OpenGraph Metadata
    {
      name: "og_title", // Match database column name
      type: "text",
      label: "OG Title",
      admin: {
        description: "OpenGraph title from meta tags",
      },
    },
    {
      name: "og_description", // Match database column name
      type: "textarea",
      label: "OG Description",
      admin: {
        description: "OpenGraph description from meta tags",
      },
    },
    {
      name: "og_image_url", // Match database column name
      type: "text",
      label: "OG Image URL",
      admin: {
        description: "OpenGraph image URL from meta tags",
      },
    },
    {
      name: "og_url", // Match database column name
      type: "text",
      label: "OG URL",
      admin: {
        description: "OpenGraph canonical URL",
      },
    },
    {
      name: "source_api_url", // Match database column name
      type: "text",
      label: "Source API URL",
      admin: {
        description: "Savee API endpoint for source resolution",
      },
    },
    {
      name: "saved_at", // Match database column name
      type: "text",
      label: "Saved At",
      admin: {
        description: "ISO timestamp when item was scraped",
      },
    },

    // Rich Metadata for Filtering/Search
    {
      name: "color_hexes", // Match database column name
      type: "json",
      label: "Color Hex Codes",
      admin: {
        description: "Array of hex color codes extracted from image",
      },
    },
    {
      name: "ai_tags", // Match database column name
      type: "json",
      label: "AI Generated Tags",
      admin: {
        description: "AI-generated descriptive tags for content",
      },
    },
    {
      name: "colors",
      type: "json",
      label: "RGB Colors",
      admin: {
        description: "Array of RGB color values",
      },
    },
    {
      name: "links",
      type: "json",
      label: "Sidebar Links",
      admin: {
        description: "Links extracted from item sidebar",
      },
    },
    {
      name: "metadata",
      type: "json",
      label: "Additional Metadata",
      admin: {
        description: "Complete sidebar info and other metadata",
      },
    },

    // Storage
    {
      name: "r2_key", // Match database column name
      type: "text",
      label: "R2 Storage Key",
      admin: {
        readOnly: true,
      },
    },

    // Error Handling
    {
      name: "errorMessage",
      type: "textarea",
      label: "Error Message",
      admin: {
        condition: (data) => data.status === "error",
      },
    },
  ],
};
