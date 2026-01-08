// Save this as: scripts/debug-payment-providers.ts
// Run with: npx tsx scripts/debug-payment-providers.ts

import { Modules } from "@medusajs/framework/utils"
import { 
  initialize as initializeModule 
} from "@medusajs/framework"

async function debugPaymentProviders() {
  console.log("🔍 Starting Payment Provider Debug...\n")

  // Initialize Medusa
  const { modules } = await initializeModule({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
  })

  const paymentModuleService = modules[Modules.PAYMENT]
  const regionModuleService = modules[Modules.REGION]

  try {
    // 1. List all registered payment providers
    console.log("1️⃣ ALL REGISTERED PAYMENT PROVIDERS:")
    console.log("=" .repeat(50))
    
    const allProviders = await paymentModuleService.listPaymentProviders()
    
    if (allProviders.length === 0) {
      console.log("❌ NO PAYMENT PROVIDERS FOUND!")
      console.log("This means no payment plugins are properly installed.\n")
    } else {
      allProviders.forEach((provider: any) => {
        console.log(`✅ ${provider.id}`)
        console.log(`   Name: ${provider.name || 'N/A'}`)
        console.log(`   Is Enabled: ${provider.is_enabled}`)
        console.log("")
      })
    }

    // 2. Check the specific region
    const regionId = "reg_01KDQJ47CPY4C99CZ2P5PF6YTD"
    
    console.log(`2️⃣ REGION DETAILS (${regionId}):`)
    console.log("=" .repeat(50))
    
    const region = await regionModuleService.retrieveRegion(regionId, {
      relations: ["payment_providers"]
    })
    
    console.log(`Region Name: ${region.name}`)
    console.log(`Currency: ${region.currency_code}`)
    console.log(`\nPayment Providers Linked to This Region:`)
    
    if (!region.payment_providers || region.payment_providers.length === 0) {
      console.log("❌ NO PAYMENT PROVIDERS LINKED TO THIS REGION!")
    } else {
      region.payment_providers.forEach((pp: any) => {
        console.log(`✅ ${pp.id}`)
      })
    }
    console.log("")

    // 3. Test the Store API endpoint (what frontend calls)
    console.log("3️⃣ WHAT THE STORE API RETURNS:")
    console.log("=" .repeat(50))
    
    try {
      const storeProviders = await paymentModuleService.listPaymentProviders({
        region_id: regionId,
        is_enabled: true
      })
      
      console.log(`Found ${storeProviders.length} enabled providers for region:`)
      storeProviders.forEach((provider: any) => {
        console.log(`✅ ${provider.id}`)
      })
      
      if (storeProviders.length === 0) {
        console.log("\n⚠️ WARNING: No providers returned by store API!")
        console.log("This is what your frontend sees.\n")
      }
    } catch (err) {
      console.error("❌ Error fetching store providers:", err)
    }

    // 4. Check if Razorpay specifically exists
    console.log("\n4️⃣ RAZORPAY SPECIFIC CHECK:")
    console.log("=" .repeat(50))
    
    const razorpayIds = [
      "razorpay-payment",
      "pp_razorpay_razorpay",
      "razorpay"
    ]
    
    for (const id of razorpayIds) {
      try {
        const provider = await paymentModuleService.retrievePaymentProvider(id)
        console.log(`✅ FOUND: ${id}`)
        console.log(`   Is Enabled: ${provider.is_enabled}`)
        console.log(`   Regions: ${provider.regions?.map((r: any) => r.id).join(", ") || "None"}`)
      } catch (err) {
        console.log(`❌ NOT FOUND: ${id}`)
      }
    }

  } catch (error) {
    console.error("\n❌ ERROR:", error)
  } finally {
    process.exit(0)
  }
}

debugPaymentProviders()