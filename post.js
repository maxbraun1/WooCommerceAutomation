import { logProcess } from "./index.js";
import descriptionGenerator from "./util/descriptionGenerator.js";
import * as dotenv from "dotenv";
import chalk from "chalk";
import { generateAttributes, generatePrices, generateQuantity, generateTitle, determineBrand } from "./util/util.js";
import pkg from "@woocommerce/woocommerce-rest-api";
const WooCommerceRestApi = pkg.default;

dotenv.config();

const WooCommerce = new WooCommerceRestApi({
  url: "https://secguns.com",
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3",
});

function postItem(item, imageLocation) {
  return new Promise(async (resolve, reject) => {
    try {
      let prices = generatePrices(item);
      let title = generateTitle(item);

      // Prepare listing data
      var data = {
        name: title,
        status: "publish",
        description: descriptionGenerator(item),
        sku: item.upc,
        regular_price: prices.regPrice.toString(),
        sale_price: prices.salePrice.toString(),
        date_on_sale_from: null,
        date_on_sale_from_gmt: null,
        date_on_sale_to: null,
        date_on_sale_to_gmt: null,
        on_sale: false,
        manage_stock: true,
        stock_quantity: generateQuantity(item),
        categories: item.categories,
        attributes: generateAttributes(item),
        shipping_class: item.shippingClass,
        brands: [await determineBrand(item.manufacturer)],
        tags: [
          { name: item.manufacturer },
          { name: item.caliber },
          { name: item.model },
          { name: item.action },
          { name: "ap" },
          { name: item.from },
        ],
        images: [
          {
            src: "https://secguns.com/" + imageLocation,
            name: title + " " + item.upc,
            alt: title + " " + item.upc,
          },
        ],
        meta_data: [
          {
            key: "_firearm_product",
            value: "yes",
          },
          {
            key: "_yoast_wpseo_focuskw",
            value: item.manufacturer + " " + item.model + " " + item.upc,
          },
          {
            key: "_yoast_wpseo_title",
            value: title + " " + item.upc,
          },
          {
            key: "_yoast_wpseo_metadesc",
            value: item.manufacturer + " " + item.model + " " + item.upc + " for sale by SEC Guns. " + item.desc,
          },
        ],
      };

      await WooCommerce.post("products", data)
        .then(function (response) {
          if (!response.data.id) {
            console.log(response);
          }
        })
        .catch(function (error) {
          console.log(error);
          reject(error);
          return;
        });

      resolve();
    } catch (error) {
      logProcess(error, "bad");
      reject(error);
      return;
    }
  });
}

export { postItem };
