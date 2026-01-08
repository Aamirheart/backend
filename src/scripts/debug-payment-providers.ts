// Save this in your BACKEND project at: src/scripts/debug-payments.ts
// Run with: npx medusa exec ./src/scripts/debug-payments.ts

import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function debugPaymentProviders({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const regionModuleService = container.resolve(Modules.REGION)

  console.log("\n🔍 STARTING PAYMENT DEBUG...\n")

  // 1. List all registered providers
  const allProviders = await paymentModuleService.listPaymentProviders()
  console.log(`1️⃣ REGISTERED PROVIDERS (${allProviders.length}):`)
  allProviders.forEach(p => console.log(`   - ${p.id} (Enabled: ${p.is_enabled})`))

  // 2. Check Specific Region (Replace ID with your actual region ID)
  // You can find IDs by running: npx medusa exec ./src/scripts/list-regions.ts
  const regionId = "reg_01KDQJ47CPY4C99CZ2P5PF6YTD" 
  
  try {
    const region = await regionModuleService.retrieveRegion(regionId, {
      relations: ["payment_providers"]
    })
    
    console.log(`\n2️⃣ REGION: ${region.name} (${region.currency_code})`)
    console.log("   Linked Providers:")
    region.payment_providers?.forEach((pp: any) => {
      console.log(`   - ${pp.id}`)
    })

    // 3. Simulate Store API Response
    const storeProviders = await paymentModuleService.listPaymentProviders({
      region_id: regionId,
      is_enabled: true
    })
    console.log(`\n3️⃣ AVAILABLE IN STOREFRONT (Enabled & Linked):`)
    storeProviders.forEach(p => console.log(`   ✅ ${p.id}`))
    
    if(storeProviders.length === 0) {
      logger.warn("⚠️ No payment providers are available for this region in the storefront!")
    }

  } catch (error) {
    console.log(`\n❌ Region ${regionId} not found or error retrieving it.`)
  }
}