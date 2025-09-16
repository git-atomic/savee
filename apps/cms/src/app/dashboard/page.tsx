import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export default function Page() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="uiflex uih-16 uishrink-0 uiitems-center uigap-2 uitransition-[width,height] uiease-linear uigroup-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="uiflex uiitems-center uigap-2 uipx-4">
            <SidebarTrigger className="ui-ml-1" />
            <Separator orientation="vertical" className="uimr-2 uih-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="uihidden md:uiblock">
                  <BreadcrumbLink href="#">
                    Building Your Application
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="uihidden md:uiblock" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Data Fetching</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="uiflex uiflex-1 uiflex-col uigap-4 uip-4 uipt-0">
          <div className="uigrid uiauto-rows-min uigap-4 md:uigrid-cols-3">
            <div className="uiaspect-video uirounded-xl uibg-muted/50" />
            <div className="uiaspect-video uirounded-xl uibg-muted/50" />
            <div className="uiaspect-video uirounded-xl uibg-muted/50" />
          </div>
          <div className="uimin-h-[100vh] uiflex-1 uirounded-xl uibg-muted/50 md:uimin-h-min" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
