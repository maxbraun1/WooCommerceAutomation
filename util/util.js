function generateAttributes(item){
  // Setting Attributes
  let attributes = [
      {
        id: 10,
        name: 'Caliber',
        position: 0,
        visible: true,
        variation: false,
        options: [ item.caliberGauge ]
      },
      {
        id: 8,
        name: 'is_firearm',
        position: 1,
        visible: false,
        variation: false,
        options: [ 'YES' ]
      }
  ]

  return attributes;
}

function generatePrices(item){
    // Setting Price
    let price;

    let cost = item.cost;
    let map = item.map; // Map will be number, 0 if there is no map

    price = cost * 1.11; // set price to cost of gun plus 11% then round to 2 decimals
    price = (Math.round(price * 100) / 100).toFixed(2);

    if(price < map){ // if new price is lower than map, set price to map
      price = map;
    }

    // if no MSRP is given, set regular price to calculated sale price
    let regPrice;
    if(item.msrp){ regPrice = item.msrp }
    else{ regPrice = price }

    // regular price cant be higher than sale price. If it is, set regular price to sale price
    if(regPrice < price){
      regPrice = price;
    }

    return { regPrice: regPrice, salePrice: price }
}

function generateQuantity(item){
  // Setting Quantity
  let quantity;

  if(item.quantity >= 50){
    quantity = 10;
  }else if(item.quantity < 50 && item.quantity >= 20){
    quantity = 5;
  }else{
    quantity = 0;
  }

  return quantity;
}

function generateTitle(item){
  var title = item.manufacturer + " " + item.model + " " + item.caliber + " " + item.capacity;

  title = Array.from(new Set(title.split(' '))).toString();
  title = title.replaceAll(",", " ");
  title = title.replaceAll("undefined", "");
  title = title.replaceAll("null", "");
}

export {generateAttributes, generatePrices, generateQuantity, generateTitle}