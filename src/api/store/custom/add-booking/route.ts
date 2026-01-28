// import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
// import { Modules } from "@medusajs/framework/utils";

// export async function POST(req: MedusaRequest, res: MedusaResponse) {
//   try {
//     console.log("--- Custom Booking Request Received ---");

//     // 1. Extract data
//     const { variant_id, quantity, country_code, therapist_id, metadata } = req.body as any;

//     if (!variant_id || !country_code) {
//       return res.status(400).json({ message: "Missing required fields (variant_id, country_code)" });
//     }

//     // 2. Define Logic for Dynamic Price
//     // Medusa prices are in MINOR units (e.g., Paise/Cents). 
//     // 1000 INR = 100000 Paise
//     let customUnitPrice = 1000 * 100; 
// // 
//     if (therapist_id === "11") {
//       customUnitPrice = 2000 * 100; // 2000 INR
//     }
    
//     console.log(`Applying Custom Price: ${customUnitPrice} (minor units) for Therapist: ${therapist_id}`);

//     // 3. Resolve Services
//     const cartModuleService = req.scope.resolve(Modules.CART);
//     const regionModuleService = req.scope.resolve(Modules.REGION);
//     const productModuleService = req.scope.resolve(Modules.PRODUCT);
//     const salesChannelModuleService = req.scope.resolve(Modules.SALES_CHANNEL);

//     // 4. Get Sales Channel (Required)
//     const [salesChannel] = await salesChannelModuleService.listSalesChannels({}, { take: 1 });
//     if (!salesChannel) {
//       return res.status(500).json({ message: "No Sales Channel found." });
//     }

//     // 5. Get Region
//     const regions = await regionModuleService.listRegions({ countries: { iso_2: country_code } });
//     if (!regions.length) {
//       return res.status(400).json({ message: `Region not found for country: ${country_code}` });
//     }
//     const region = regions[0];

//     // 6. Get Product & Variant for Title
//     const [variant] = await productModuleService.listProductVariants({ id: [variant_id] });
//     if (!variant) return res.status(404).json({ message: "Variant not found" });

//     const [product] = await productModuleService.listProducts({ id: [variant.product_id] });
    
//     const lineItemTitle = variant.title === "Default Variant" 
//       ? product.title 
//       : `${product.title} - ${variant.title}`;

//     // 7. Create the Cart
//     const cart = await cartModuleService.createCarts({
//       sales_channel_id: salesChannel.id,
//       region_id: region.id,
//       currency_code: region.currency_code,
//       items: [
//         {
//           variant_id: variant_id,
//           quantity: quantity ?? 1,
//           unit_price: customUnitPrice,
//           title: lineItemTitle,
          
//           // --- FIX IS HERE ---
//           // This tells Medusa: "Do NOT recalculate this price from the Admin Dashboard."
//           is_custom_price: true, 
//           // -------------------

//           metadata: {
//             ...metadata,
//             therapist_id: therapist_id
//           }
//         }
//       ]
//     });

//     console.log("Cart Created Successfully:", cart.id);

//     return res.json({ cart_id: cart.id });

//   } catch (error: any) {
//     console.error("CRITICAL ERROR in /store/custom/add-booking:", error);
//     return res.status(500).json({ message: error.message || "Internal Server Error" });
//   }
// }




import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    console.log("--- Debug: Custom Booking Start ---");
    const { variant_id, quantity, country_code, therapist_id, metadata } = req.body as any;

    if (!variant_id || !country_code) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // 1. Resolve Services
    const cartModuleService = req.scope.resolve(Modules.CART);
    const regionModuleService = req.scope.resolve(Modules.REGION);
    const productModuleService = req.scope.resolve(Modules.PRODUCT);
    const salesChannelService = req.scope.resolve(Modules.SALES_CHANNEL);

    // 2. Fetch Default Sales Channel (CORRECTED)
    // We pass {} as filters, and { take: 1 } as config
    const salesChannels = await salesChannelService.list({}, { take: 1 });
    const defaultSalesChannel = salesChannels[0];

    if (!defaultSalesChannel) {
      return res.status(400).json({ message: "No Sales Channel found in store. Please create one in Admin." });
    }

    // 3. Validate Variant & Fetch Product Title
    const variants = await productModuleService.listProductVariants(
      { id: [variant_id] },
      { relations: ["product"] }
    );

    if (variants.length === 0) {
        return res.status(404).json({ message: `Variant ${variant_id} does not exist` });
    }
    const variant = variants[0];

    // 4. Get Region
    const regions = await regionModuleService.listRegions({ countries: { iso_2: country_code } });
    if (!regions.length) {
      return res.status(400).json({ message: `Region not found for country: ${country_code}` });
    }
    const region = regions[0];

    // 5. Calculate Custom Price
    let customUnitPrice = 100000; 
    if (therapist_id === "11") customUnitPrice = 200000;

    console.log(`Creating Cart for Sales Channel: ${defaultSalesChannel.id} (${defaultSalesChannel.name})`);

    // 6. Create Cart with Sales Channel ID
    const cart = await cartModuleService.createCarts({
      region_id: region.id,
      sales_channel_id: defaultSalesChannel.id, // <--- Explicitly assigning channel
      currency_code: region.currency_code,
      email: metadata?.email, 
      items: [
        {
          variant_id: variant_id,
          quantity: quantity ?? 1,
          unit_price: customUnitPrice, 
          title: variant.product.title, 
          subtitle: variant.title,
          metadata: {
            ...metadata,
            therapist_id,
            is_dynamic_price: true
          }
        }
      ]
    });

    console.log("SUCCESS: Cart created", cart.id);
    return res.json({ cart_id: cart.id });

  } catch (error: any) {
    console.error("CRITICAL ERROR:", error);
    return res.status(500).json({ message: error.message });
  }
}