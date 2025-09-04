import { CollectionConfig } from "payload";

export const SaveeUsers: CollectionConfig = {
  slug: "savee_users",
  labels: {
    singular: "Savee User",
    plural: "Savee Users",
  },
  admin: {
    description: "Savee.com user profiles discovered during scraping",
    useAsTitle: "display_name",
    defaultColumns: [
      "avatar",
      "username",
      "display_name",
      "follower_count",
      "saves_count",
      "last_scraped_at",
      "is_active",
    ],
    group: "Savee Data",
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    // Avatar preview (UI only)
    {
      name: "avatar",
      type: "ui",
      admin: {
        components: {
          Cell: "@/components/SaveeUserAvatarCell",
        },
      },
      label: "Avatar",
    },
    // Basic profile info
    {
      name: "username",
      type: "text",
      required: true,
      unique: true,
      admin: {
        description: "Savee.com username (unique identifier)",
      },
    },
    {
      name: "display_name",
      type: "text",
      admin: {
        description: "Display name shown on profile",
      },
    },
    {
      name: "bio",
      type: "textarea",
      admin: {
        description: "User bio/description",
      },
    },
    {
      name: "profile_image_url",
      type: "text",
      admin: {
        description: "URL to profile avatar image",
      },
    },
    {
      name: "avatar_r2_key",
      type: "text",
      admin: {
        description: "R2 key for stored avatar (when available)",
      },
    },
    {
      name: "cover_image_url",
      type: "text",
      admin: {
        description: "URL to profile cover/banner image",
      },
    },
    {
      name: "profile_url",
      type: "text",
      required: true,
      admin: {
        description: "Full URL to Savee profile page",
      },
    },

    // Statistics
    {
      name: "follower_count",
      type: "number",
      defaultValue: 0,
      admin: {
        description: "Number of followers",
      },
    },
    {
      name: "following_count",
      type: "number",
      defaultValue: 0,
      admin: {
        description: "Number of people this user follows",
      },
    },
    {
      name: "saves_count",
      type: "number",
      defaultValue: 0,
      admin: {
        description: "Total number of saves/items",
      },
    },
    {
      name: "collections_count",
      type: "number",
      defaultValue: 0,
      admin: {
        description: "Number of collections created",
      },
    },

    // Additional info
    {
      name: "location",
      type: "text",
      admin: {
        description: "User location (if provided)",
      },
    },
    {
      name: "website_url",
      type: "text",
      admin: {
        description: "Personal website URL",
      },
    },
    {
      name: "social_links",
      type: "json",
      admin: {
        description: "Social media links and profiles",
      },
    },

    // Status
    {
      name: "is_verified",
      type: "checkbox",
      defaultValue: false,
      admin: {
        description: "Whether the user has a verified account",
      },
    },
    {
      name: "is_active",
      type: "checkbox",
      defaultValue: true,
      admin: {
        description: "Whether the account is still active",
      },
    },
    {
      name: "last_scraped_at",
      type: "date",
      admin: {
        description: "When this profile was last updated/scraped",
        date: {
          pickerAppearance: "dayAndTime",
        },
      },
    },
    {
      name: "first_discovered_at",
      type: "date",
      admin: {
        description: "When this user was first discovered",
        date: {
          pickerAppearance: "dayAndTime",
        },
      },
    },
  ],

  // Database table options
  dbName: "savee_users",
};
