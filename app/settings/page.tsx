import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user}>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm">
                {user.user_metadata?.full_name || "Not set"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Design Profile</CardTitle>
            <CardDescription>Your design preferences (v1: hard-coded)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-sm font-medium">Style</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {["Modern Warm", "Urban Contemporary", "Boutique Hotel", "Elevated Masculine"].map(
                  (style) => (
                    <Badge key={style} variant="secondary">
                      {style}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Palette</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {["Walnut", "Oatmeal", "Taupe", "Cream", "Camel", "Olive"].map(
                  (color) => (
                    <Badge key={color} variant="outline">
                      {color}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <div>
              <span className="text-sm font-medium">Location</span>
              <p className="text-sm text-muted-foreground mt-1">
                West Loop, Chicago - Porte Apartments
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Configuration</CardTitle>
            <CardDescription>External service status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { name: "OpenAI (GPT)", key: "OPENAI_API_KEY" },
              { name: "Tavily (Search)", key: "TAVILY_API_KEY" },
              { name: "Jina (Scraping)", key: "JINA_API_KEY" },
            ].map((service) => (
              <div key={service.key} className="flex items-center justify-between">
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
