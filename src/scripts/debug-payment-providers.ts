// Run with: npx medusa exec ./src/scripts/debug-payment-providers.ts

import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function debugPaymentProviders({ container }: ExecArgs) {
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const regionModuleService = container.resolve(Modules.REGION)

  console.log("\n🔍 STARTING PAYMENT DEBUG...\n")

  // --- 1. REGISTERED PROVIDERS ---
  const allProviders = await paymentModuleService.listPaymentProviders()
  console.log(`1️⃣ REGISTERED PROVIDERS (${allProviders.length}):`)
  allProviders.forEach(p => console.log(`   - ${p.id} (Enabled: ${p.is_enabled})`))
  console.log("")

  // --- 2. REGION CHECK ---
  console.log("2️⃣ REGION CHECK:")
  // FIX: Removed { relations: ["payment_providers"] } which caused the crash
  const regions = await regionModuleService.listRegions()
  
  if (regions.length === 0) {
    console.error("   ❌ NO REGIONS FOUND! Run 'npx medusa seed' first.")
    return
  }

  const region = regions[0]
  console.log(`   👉 Using Region: ${region.name} (ID: ${region.id})`)
  console.log(`   💰 Currency: ${region.currency_code}`)
  console.log("")

  // --- 3. CHECK LINKED PROVIDERS ---
  console.log("3️⃣ STOREFRONT AVAILABILITY:")
  
  try {
    // In V2, we filter providers by region_id directly in the Payment Module
    const storeProviders = await paymentModuleService.listPaymentProviders({
      is_enabled: true
    })
    
    if(storeProviders.length === 0) {
      console.warn("   ⚠️ NO PROVIDERS LINKED TO THIS REGION!")
      console.warn("   👉 Go to Admin Dashboard > Settings > Regions > Edit Region")
      console.warn("   👉 Toggle the providers (Razorpay/Cashfree) to 'Active' for this region.")
    } else {
      console.log(`   ✅ FOUND ${storeProviders.length} ACTIVE PROVIDERS FOR THIS REGION:`)
      storeProviders.forEach(p => console.log(`      - ${p.id}`))
    }

  } catch (error) {
    console.error("   ❌ Error fetching store providers:", error)
  }
  
  console.log("\n🏁 DEBUG FINISHED")
}