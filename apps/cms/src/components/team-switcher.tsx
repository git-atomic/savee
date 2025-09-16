"use client"

import * as React from "react"
import { ChevronsUpDown, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function TeamSwitcher({
  teams,
}: {
  teams: {
    name: string
    logo: React.ElementType
    plan: string
  }[]
}) {
  const { isMobile } = useSidebar()
  const [activeTeam, setActiveTeam] = React.useState(teams[0])

  if (!activeTeam) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:uibg-sidebar-accent data-[state=open]:uitext-sidebar-accent-foreground"
            >
              <div className="uiflex uiaspect-square uisize-8 uiitems-center uijustify-center uirounded-lg uibg-sidebar-primary uitext-sidebar-primary-foreground">
                <activeTeam.logo className="uisize-4" />
              </div>
              <div className="uigrid uiflex-1 uitext-left uitext-sm uileading-tight">
                <span className="uitruncate uifont-semibold">
                  {activeTeam.name}
                </span>
                <span className="uitruncate uitext-xs">{activeTeam.plan}</span>
              </div>
              <ChevronsUpDown className="uiml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="uiw-[--radix-dropdown-menu-trigger-width] uimin-w-56 uirounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="uitext-xs uitext-muted-foreground">
              Teams
            </DropdownMenuLabel>
            {teams.map((team, index) => (
              <DropdownMenuItem
                key={team.name}
                onClick={() => setActiveTeam(team)}
                className="uigap-2 uip-2"
              >
                <div className="uiflex uisize-6 uiitems-center uijustify-center uirounded-sm uiborder">
                  <team.logo className="uisize-4 uishrink-0" />
                </div>
                {team.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="uigap-2 uip-2">
              <div className="uiflex uisize-6 uiitems-center uijustify-center uirounded-md uiborder uibg-background">
                <Plus className="uisize-4" />
              </div>
              <div className="uifont-medium uitext-muted-foreground">Add team</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
