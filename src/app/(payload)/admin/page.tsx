/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { Metadata } from 'next'

import config from '@payload-config'
import { RootPage, generatePageMetadata } from '@payloadcms/next/views'
import { importMap } from './importMap.js'

type Args = {
  params: {}
  searchParams: { [key: string]: string | string[] }
}

export const generateMetadata = ({ searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({
    config,
    searchParams,
  })

const Page = ({ params, searchParams }: Args) => (
  <RootPage
    config={config}
    importMap={importMap}
    params={params}
    searchParams={searchParams}
  />
)

export default Page
