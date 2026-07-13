import { afterEach, describe, expect, it } from "vitest";
import { buildActivationEmail1 } from "@/lib/email/templates/lifecycle";

describe("lifecycle template CAN-SPAM footer", () => {
  const orig = process.env.EMAIL_PHYSICAL_ADDRESS;
  afterEach(() => {
    if (orig === undefined) delete process.env.EMAIL_PHYSICAL_ADDRESS;
    else process.env.EMAIL_PHYSICAL_ADDRESS = orig;
  });

  it("omits the address line when EMAIL_PHYSICAL_ADDRESS is unset", () => {
    delete process.env.EMAIL_PHYSICAL_ADDRESS;
    const { html, text } = buildActivationEmail1("https://aptdesignerai.com");
    expect(html).not.toMatch(/123 Main St/);
    expect(text).not.toMatch(/123 Main St/);
  });

  it("renders the real address in both html and text once set", () => {
    process.env.EMAIL_PHYSICAL_ADDRESS = "123 Main St, Springfield, ST 00000";
    const { html, text } = buildActivationEmail1("https://aptdesignerai.com");
    expect(html).toContain("123 Main St, Springfield, ST 00000");
    expect(text).toContain("123 Main St, Springfield, ST 00000");
  });
});
