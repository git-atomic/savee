"use client"

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:uibg-sidebar-accent data-[state=open]:uitext-sidebar-accent-foreground"
            >
              <Avatar className="uih-8 uiw-8 uirounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="uirounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="uigrid uiflex-1 uitext-left uitext-sm uileading-tight">
                <span className="uitruncate uifont-semibold">{user.name}</span>
                <span className="uitruncate uitext-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="uiml-auto uisize-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="uiw-[--radix-dropdown-menu-trigger-width] uimin-w-56 uirounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="uip-0 uifont-normal">
              <div className="uiflex uiitems-center uigap-2 uipx-1 uipy-1.5 uitext-left uitext-sm">
                <Avatar className="uih-8 uiw-8 uirounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="uirounded-lg">CN</AvatarFallback>
                </Avatar>
                <div className="uigrid uiflex-1 uitext-left uitext-sm uileading-tight">
                  <span className="uitruncate uifont-semibold">{user.name}</span>
                  <span className="uitruncate uitext-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
