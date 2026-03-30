import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Palette, Plug } from "lucide-react";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
                <User className="h-4.5 w-4.5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Account</CardTitle>
                <CardDescription>Your account information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user.email}</span>
            </div>
            <div className="border-t" />
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">
                {user.user_metadata?.full_name || "Not set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
                <Palette className="h-4.5 w-4.5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Design Profile</CardTitle>
                <CardDescription>Your design preferences</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Style</span>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {["Modern Warm", "Urban Contemporary", "Boutique Hotel", "Elevated Masculine"].map(
                  (style) => (
                    <Badge key={style} variant="secondary" className="py-1 px-3">
                      {style}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <div className="border-t pt-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Palette</span>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {["Walnut", "Oatmeal", "Taupe", "Cream", "Camel", "Olive"].map(
                  (color) => (
                    <Badge key={color} variant="outline" className="py-1 px-3">
                      {color}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <div className="border-t pt-4">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location</span>
              <p className="text-sm mt-1.5">
                West Loop, Chicago - Porte Apartments
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary">
                <Plug className="h-4.5 w-4.5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">API Configuration</CardTitle>
                <CardDescription>External service status</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { name: "OpenAI (GPT)", key: "OPENAI_API_KEY" },
              { name: "Tavily (Search)", key: "TAVILY_API_KEY" },
              { name: "Jina (Scraping)", key: "JINA_API_KEY" },
            ].map((service) => (
              <div key={service.key} className="flex items-center justify-between py-2.5">
                <span className="text-sm">{service.name}</span>
                <Badge variant="secondary">Configured via env</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
