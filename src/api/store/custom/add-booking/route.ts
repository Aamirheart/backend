import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    console.log("--- Custom Booking Request Received ---");

    // 1. Extract data
    const { variant_id, quantity, country_code, therapist_id, metadata } = req.body as any;

    if (!variant_id || !country_code) {
      return res.status(400).json({ message: "Missing required fields (variant_id, country_code)" });
    }

    // 2. Define Logic for Dynamic Price
    // Medusa prices are in MINOR units (e.g., Paise/Cents). 
    // 1000 INR = 100000 Paise
    let customUnitPrice = 1000 * 100; 

    if (therapist_id === "11") {
      customUnitPrice = 2000 * 100; // 2000 INR
    }
    
    console.log(`Applying Custom Price: ${customUnitPrice} (minor units) for Therapist: ${therapist_id}`);

    // 3. Resolve Services
    const cartModuleService = req.scope.resolve(Modules.CART);
    const regionModuleService = req.scope.resolve(Modules.REGION);
    const productModuleService = req.scope.resolve(Modules.PRODUCT);
    const salesChannelModuleService = req.scope.resolve(Modules.SALES_CHANNEL);

    // 4. Get Sales Channel (Required)
    const [salesChannel] = await salesChannelModuleService.listSalesChannels({}, { take: 1 });
    if (!salesChannel) {
      return res.status(500).json({ message: "No Sales Channel found." });
    }

    // 5. Get Region
    const regions = await regionModuleService.listRegions({ countries: { iso_2: country_code } });
    if (!regions.length) {
      return res.status(400).json({ message: `Region not found for country: ${country_code}` });
    }
    const region = regions[0];

    // 6. Get Product & Variant for Title
    const [variant] = await productModuleService.listProductVariants({ id: [variant_id] });
    if (!variant) return res.status(404).json({ message: "Variant not found" });

    const [product] = await productModuleService.listProducts({ id: [variant.product_id] });
    
    const lineItemTitle = variant.title === "Default Variant" 
      ? product.title 
      : `${product.title} - ${variant.title}`;

    // 7. Create the Cart
    const cart = await cartModuleService.createCarts({
      sales_channel_id: salesChannel.id,
      region_id: region.id,
      currency_code: region.currency_code,
      items: [
        {
          variant_id: variant_id,
          quantity: quantity ?? 1,
          unit_price: customUnitPrice,
          title: lineItemTitle,
          
          // --- FIX IS HERE ---
          // This tells Medusa: "Do NOT recalculate this price from the Admin Dashboard."
          is_custom_price: true, 
          // -------------------

          metadata: {
            ...metadata,
            therapist_id: therapist_id
          }
        }
      ]
    });

    console.log("Cart Created Successfully:", cart.id);

    return res.json({ cart_id: cart.id });

  } catch (error: any) {
    console.error("CRITICAL ERROR in /store/custom/add-booking:", error);
    return res.status(500).json({ message: error.message || "Internal Server Error" });
  }
}