import * as dotenv from "dotenv";
import chalk from "chalk";
import { prepLipseysInventory, checkLipseysInventory } from "./lipseys.js";
import { prepDavidsonsInventory, checkDavidsonsInventory } from "./davidsons.js";
import { prepRSRInventory, checkRSRInventory } from "./rsr.js";
import { prepSSInventory, checkSSInventory } from "./sportssouth.js";
import pkg from "@woocommerce/woocommerce-rest-api";

import { postItem } from "./post.js";
import { generateImages } from "./imageGenerator.js";
const WooCommerceRestApi = pkg.default;

dotenv.config();

const WooCommerce = new WooCommerceRestApi({
  url: "https://secguns.com",
  consumerKey: process.env.SEC_KEY,
  consumerSecret: process.env.SEC_SECRET,
  version: "wc/v3",
});

function logProcess(message, type) {
  console.log("_________________________________________________________________________________");
  switch (type) {
    case "good":
      console.log(chalk.green(message));
      break;
    case "bad":
      console.log(chalk.red(message));
      break;
    case "warning":
      console.log(chalk.yellow(message));
      break;
    default:
      console.log(chalk.magenta(message));
  }
}

function checkAlreadyPosted(upc) {
  return new Promise(async (resolve, reject) => {
    WooCommerce.get("products/?sku=" + upc)
      .then((response) => {
        if (response.data.length > 0) {
          resolve(true);
        } else {
          resolve(false);
        }
      })
      .catch((error) => {
        console.log(error.response.data);
        reject(error);
      });
  });
}

function getAllListings() {
  return new Promise((resolve, reject) => {
    WooCommerce.get("products?per_page=100")
      .then(async function (response) {
        let pages = response.headers["x-wp-totalpages"];
        let listings = [];
        for (let x = 0; x < pages; x++) {
          let offset = x * 100;
          await WooCommerce.get("products?per_page=100&offset=" + offset)
            .then(function (response) {
              response.data.map((item) => {
                let newListing = {};
                newListing.id = item.id;
                newListing.upc = parseInt(item.sku);
                newListing.quantity = item.stock_quantity;
                newListing.tags = item.tags;

                listings.push(newListing);
              });
            })
            .catch(function (error) {
              console.log(error);
              reject(new Error(error));
            });
        }
        resolve(listings);
      })
      .catch(function (error) {
        console.log(error);
        reject(new Error(error));
      });
  });
}

async function checkAllListings() {
  // Get every SEC listing item No
  logProcess("Getting all SEC Guns listings");
  let listings = await getAllListings();

  // Get every listing from Lipseys, Davidsons, RSR, and SportsSouth
  logProcess("Getting Lipseys Inventory");
  let LipseysInventory = await checkLipseysInventory();
  logProcess("Getting Davidsons Inventory");
  let DavidsonsInventory = await checkDavidsonsInventory();
  logProcess("Getting RSR Inventory");
  let RSRInventory = await checkRSRInventory();
  logProcess("Getting Sports South Inventory");
  let SSInventory = await checkSSInventory();

  if (
    LipseysInventory.length < 100 ||
    DavidsonsInventory.length < 100 ||
    RSRInventory.length < 100 ||
    SSInventory.length < 100
  ) {
    console.log("Fetching of one or more vendors failed.");
    return;
  }

  // Loop through every SEC Guns listing
  console.log(chalk.green.bold("Checking " + listings.length + " listings."));
  for (let i = 0; i < listings.length; i++) {
    let listing = listings[i];

    if (!listing.tags.find((tag) => tag.name == "ap")) {
      continue;
    }

    if (listing) {
      let lipseysResults = await LipseysInventory.find((item) => item.upc == listing.upc);
      let RSRResults = await RSRInventory.find((item) => item.upc == listing.upc);
      let davidsonsResults = await DavidsonsInventory.find((item) => item.upc == listing.upc);
      let SSResults = await SSInventory.find((item) => item.upc == listing.upc);

      let availableQTY = 0;

      if (lipseysResults) {
        availableQTY = availableQTY + lipseysResults.quantity;
      }
      if (RSRResults) {
        availableQTY = availableQTY + RSRResults.quantity;
      }
      if (davidsonsResults) {
        availableQTY = availableQTY + davidsonsResults.quantity;
      }
      if (SSResults) {
        availableQTY = availableQTY + SSResults.quantity;
      }

      if (listing.quantity > availableQTY - 10 && listing.quantity != 0) {
        // if quantity listed is less than quantity available minus 10, set quantity to 0

        const data = {
          stock_quantity: 0,
        };

        await WooCommerce.put("products/" + listing.id, data)
          .then((response) => {
            console.log(chalk.bold.red("Listing QTY: " + listing.quantity + " | Vendor QTY: " + availableQTY));
            console.log(chalk.bold.yellow("[" + listing.upc + "] Item quantity set to 0."));
          })
          .catch((error) => {
            console.log("error", error);
          });
      }
    }
  }
  console.log("done");
  return;
}

async function updateQuantity(item) {
  await WooCommerce.get("products/?sku=" + item.upc)
    .then(async (response) => {
      let quantityPosted = response.data[0].stock_quantity;
      let productID = response.data[0].id;
      if (quantityPosted == 0) {
        // Setting Quantity
        let quantity;

        if (item.quantity >= 50) {
          quantity = 10;
        } else if (item.quantity < 50 && item.quantity >= 20) {
          quantity = 5;
        } else {
          return;
        }

        // Update Quantity
        const data = {
          stock_quantity: quantity,
        };

        await WooCommerce.put("products/" + productID, data)
          .then((response) => {
            console.log(chalk.green.bold("[" + item.upc + "] Item quantity updated."));
          })
          .catch((error) => {
            console.log(error.response.data);
          });
      }
    })
    .catch((error) => {
      console.log(error.response.data);
    });
}

async function checkDuplicates(inventory) {
  let duplicateCount = 0;
  let newInventory = await inventory.map((item) => {
    let matches = inventory.filter((x) => x.upc == item.upc && x.from != item.from);
    if (matches.length > 0) {
      duplicateCount = duplicateCount + matches.length;
      let highestCost = item.cost;
      let quantity = item.quantity;
      matches.map((match) => {
        quantity = quantity + match.quantity;
        if (match.cost > highestCost) {
          highestCost = match.cost;
        }
        inventory.splice(inventory.indexOf(match), 1);
      });
      item.cost = highestCost;
      item.quantity = quantity;
    }
    return item;
  });
  console.log(chalk.bold.yellow("Found " + duplicateCount + " duplicates."));
  return newInventory;
}

async function postAllItems(listings, limit) {
  logProcess("Posting " + chalk.bold.green(listings.length) + " items on SEC");

  let count = 0;
  let countPosted = 0;

  for (let item of listings) {
    count++;

    if (countPosted >= limit) {
      return;
    }

    // Check if item is already posted
    let alreadyPosted = await checkAlreadyPosted(item.upc);
    if (alreadyPosted) {
      console.log(
        chalk.bold.blue.bgWhite(" Item " + count + " / " + listings.length + " ") +
          chalk.bold.yellow(" [" + item.upc + "] Item already posted.")
      );
      await updateQuantity(item);
    } else {
      await generateImages(item.imgURL, item.upc)
        .then(async (imageLocation) => {
          await postItem(item, imageLocation)
            .catch((error) => console.log(error))
            .then(() => {
              countPosted++;
              console.log(
                chalk.bold.blue.bgWhite(" Item " + count + " / " + listings.length + " ") +
                  chalk.bold.green(
                    " [" + item.upc + "] " + item.from + " Item (" + item.manufacturer + " " + item.model + ") Posted"
                  )
              );
            });
        })
        .catch((error) => {
          console.log(error);
        });
    }
  }
  console.log(chalk.bold.green("Posting complete. " + countPosted + " listings posted."));
  return countPosted;
}

async function post(vendors) {
  let inventory = [];

  if (vendors.lip) {
    let lipseysInventory = await prepLipseysInventory();
    console.log(chalk.bold.green("------------- LIPSEYS -------------"));
    console.log(lipseysInventory.length);
    inventory.push(...lipseysInventory);
  }
  if (vendors.dav) {
    let davidsonsInventory = await prepDavidsonsInventory();
    console.log(chalk.bold.green("------------ DAVIDSONS ------------"));
    console.log(davidsonsInventory.length);
    inventory.push(...davidsonsInventory);
  }
  if (vendors.rsr) {
    let rsrInventory = await prepRSRInventory();
    console.log(chalk.bold.green("--------------- RSR ---------------"));
    console.log(rsrInventory.length);
    inventory.push(...rsrInventory);
  }
  if (vendors.ss) {
    let ssInventory = await prepSSInventory();
    console.log(chalk.bold.green("----------- SPORTS SOUTH ----------"));
    console.log(ssInventory.length);
    inventory.push(...ssInventory);
  }

  console.log(inventory.length + " total products before duplicate check");

  // Check for duplicates
  inventory = await checkDuplicates(inventory);

  await postAllItems(inventory);
}

// START
//post({ lip: false, dav: false, rsr: false, ss: true });
checkAllListings();

export { logProcess };
