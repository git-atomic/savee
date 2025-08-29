/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { Metadata } from 'next'

import config from '@payload-config'
import { RootLayout } from '@payloadcms/next/layouts'
import React from 'react'

import { importMap } from './importMap.js'

type Args = {
  children: React.ReactNode
}

export default function Layout({ children }: Args) {
  return (
    <RootLayout config={config} importMap={importMap}>
      {children}
    </RootLayout>
  )
}

export const metadata: Metadata = {
  title: {
    default: 'Savee Scraper CMS',
    template: '%s | Savee Scraper CMS',
  },
  description: 'Savee.it Content Management System',
}
