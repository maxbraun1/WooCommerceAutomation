import axios from "axios";
import * as dotenv from "dotenv";
import stringSimilarity from "string-similarity";
import pkg from "@woocommerce/woocommerce-rest-api";
import chalk from "chalk";
const WooCommerceRestApi = pkg.default;

dotenv.config();

const WooCommerce = new WooCommerceRestApi({
  url: "https://secguns.com",
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3",
});

function generateAttributes(item) {
  // Setting Attributes
  let attributes = [
    {
      id: 10,
      name: "Caliber",
      position: 0,
      visible: true,
      variation: false,
      options: [item.caliber],
    },
    {
      id: 8,
      name: "is_firearm",
      position: 1,
      visible: false,
      variation: false,
      options: ["YES"],
    },
  ];

  return attributes;
}

function generatePrices(item) {
  // Setting Price
  let price;

  let cost = item.cost;
  let map = item.map; // Map will be number, 0 if there is no map

  price = cost * 1.11; // set price to cost of gun plus 11% then round to 2 decimals
  price = (Math.round(price * 100) / 100).toFixed(2);

  if (price < map) {
    // if new price is lower than map, set price to map
    price = map;
  }

  // if no MSRP is given, set regular price to calculated sale price
  let regPrice;
  if (item.msrp) {
    regPrice = item.msrp;
  } else {
    regPrice = price;
  }

  // regular price cant be higher than sale price. If it is, set regular price to sale price
  if (regPrice < price) {
    regPrice = price;
  }

  return { regPrice: regPrice, salePrice: price };
}

function generateQuantity(item) {
  // Setting Quantity
  let quantity;

  if (item.quantity >= 50) {
    quantity = 10;
  } else if (item.quantity < 50 && item.quantity >= 20) {
    quantity = 5;
  } else {
    quantity = 0;
  }

  return quantity;
}

function generateTitle(item) {
  var title = item.manufacturer + " " + item.model + " " + item.caliber + " " + item.capacity;

  title = Array.from(new Set(title.split(" "))).toString();
  title = title.replaceAll(",", " ");
  title = title.replaceAll("undefined", "");
  title = title.replaceAll("null", "");

  return title;
}

// Brand
let brands = [{ name: "", id: null }];

async function getBrands() {
  // Gets all brands from SEC and returns as array of objects {name:[name], id:[id]}
  await axios
    .get("https://secguns.com/wp-json/wc/v2/products/brands?per_page=100", {
      auth: {
        username: process.env.SEC_WORDPRESS_USER,
        password: process.env.SEC_WORDPRESS_PASS,
      },
    })
    .then(async function (response) {
      let pages = response.headers["x-wp-totalpages"];
      let brandList = [];
      for (let x = 0; x < pages; x++) {
        let offset = x * 100;
        await axios
          .get("https://secguns.com/wp-json/wc/v2/products/brands?per_page=100&offset=" + offset, {
            auth: {
              username: process.env.SEC_WORDPRESS_USER,
              password: process.env.SEC_WORDPRESS_PASS,
            },
          })
          .then(async function (response) {
            await response.data.map((item) => {
              let newBrand = {};
              newBrand.name = item.name;
              newBrand.id = item.id;

              brandList.push(newBrand);
            });
          })
          .catch(function (error) {
            console.log(error);
          });
      }
      brands.push(...brandList);
    })
    .catch(function (error) {
      console.log(error);
    });
}

await getBrands();

async function determineBrand(brand) {
  let brandNames = brands.map((item) => {
    return item.name.toLowerCase().replace("&amp;", "&");
  });
  let match = stringSimilarity.findBestMatch(brand.toLowerCase(), brandNames);
  let bestMatch = brands.find((item) => item.name.toLowerCase().replace("&amp;", "&") === match.bestMatch.target);

  console.log("given '" + brand + "' found best match '" + bestMatch.name + "' with rating: " + match.bestMatch.rating);
  if (match.bestMatch.rating >= 0.85) {
    return bestMatch.id;
  }
  // Brand doesn't exist, create brand
  const data = {
    name: brand,
  };

  return await WooCommerce.post("products/brands", data)
    .then((response) => {
      console.log(chalk.bold.yellow("New brand created: " + response.data.name));
      brands.push({ name: brand, id: response.data.id });
      return response.data.id;
    })
    .catch((error) => {
      console.log(error);
      return null;
    });
}

// Caliber
let calibers = new Promise(async function (resolve, reject) {
  // Gets all calibers from SEC and returns as array of objects {name:[name], id:[id]}
  await WooCommerce.get("products/attributes/10/terms?per_page=100")
    .then(async function (response) {
      let pages = response.headers["x-wp-totalpages"];
      let caliberList = [];
      for (let x = 0; x < pages; x++) {
        let offset = x * 100;
        await WooCommerce.get("products/attributes/10/terms?per_page=100&offset=" + offset)
          .then(function (response) {
            response.data.map((item) => {
              let newCaliber = {};
              newCaliber.name = item.name;
              newCaliber.id = item.id;

              caliberList.push(newCaliber);
            });
          })
          .catch(function (error) {
            console.log(error);
            reject(new Error(error));
          });
      }
      resolve(caliberList);
    })
    .catch(function (error) {
      console.log(error);
      reject(new Error(error));
    });
});

async function determineCaliber(caliber) {
  let caliberList = await calibers;
  if (caliberList.length < 1) {
    return caliber;
  } else {
    let caliberNames = caliberList.map((item) => {
      return item.name;
    });
    let match = stringSimilarity.findBestMatch(caliber, caliberNames);
    let bestMatch = caliberList.find((item) => item.name === match.bestMatch.target);
    if (match.bestMatch.rating >= 0.85) {
      console.log(
        "Given '" + caliber + "', found '" + bestMatch.name + "' with " + match.bestMatch.rating * 100 + "% similarity."
      );
      return bestMatch.name;
    } else {
      return caliber;
    }
  }
}

export { generateAttributes, generatePrices, generateQuantity, generateTitle, determineBrand, determineCaliber };
