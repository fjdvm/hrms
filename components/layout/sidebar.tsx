"use client";

import React from "react";
import { useMounted } from "@/hooks/use-mounted";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { activeHref, sidebarFor } from "./sidebar-nav";
import { usePermittedPages } from "./staff-context";
import { SidebarProfileFooter } from "./sidebar-profile-footer";
import { SidebarNavSkeleton } from "./sidebar-nav-skeleton";
import { SidebarEnterpriseHeader } from "./sidebar-enterprise-header";

export function Sidebar() {
  const pathname = usePathname();
  const { open, openMobile, setOpenMobile, toggleSidebar, isMobile } =
    useSidebar();
  const mounted = useMounted();
  const permittedPages = usePermittedPages();
  const sections = sidebarFor(permittedPages);
  const active = activeHref(pathname, sections);

  const isOpen = isMobile ? openMobile : open;

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  if (mounted && !isOpen) {
    return null;
  }

  return (
    <>
      {isMobile && (
        <div
          onClick={toggleSidebar}
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[55] animate-in fade-in duration-200"
        />
      )}
      <aside className="fixed left-0 top-0 h-full w-(--sidebar-width) flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground z-[60] transition-all duration-300 shadow-xl md:shadow-none animate-in slide-in-from-left duration-300">
        <SidebarEnterpriseHeader isMobile={isMobile} />

        <SidebarContent className="px-3 py-4 overflow-y-auto">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              {!mounted ? (
                <SidebarNavSkeleton rows={1} />
              ) : (
                sections.map((section, i) => (
                  <div key={section.label ?? i} className={i > 0 ? "mt-3" : undefined}>
                    {section.label && (
                      <SidebarGroupLabel className="h-auto px-2.5 pb-1 pt-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/60">
                        {section.label}
                      </SidebarGroupLabel>
                    )}
                    <SidebarMenu className="gap-0.5">
                      {section.items.map((item) => {
                        const ItemIcon = item.icon;
                        const { href } = item;
                        const isActive = href === active;

                        return (
                          <SidebarMenuItem key={item.name}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              className="h-auto w-full flex items-center gap-3 px-2.5 py-[9px] rounded-lg text-[15px] font-medium text-sidebar-foreground transition-colors data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                            >
                              <Link href={href} onClick={handleNavClick}>
                                <ItemIcon className="size-[18px] shrink-0" />
                                <span>{item.name}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </div>
                ))
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="py-3.5 pl-4 pr-3 border-t border-sidebar-border">
          <SidebarProfileFooter />
        </SidebarFooter>

        <SidebarRail />
      </aside>
    </>
  );
}
