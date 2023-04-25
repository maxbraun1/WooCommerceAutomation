function descriptionGenerator(item){
    let html = "";

    html = html + "<table>";
    if(item.desc){ html = html + "<tr><td>Description</td><td>"+item.desc+"</td></tr>" }
    if(item.caliber){ html = html + "<tr><td>Caliber</td><td>"+item.caliber+"</td></tr>" }
    if(item.action){ html = html + "<tr><td>Action</td><td>"+item.action+"</td></tr>" }
    if(item.capacity){ html = html + "<tr><td>Capacity</td><td>"+item.capacity+"</td></tr>" }
    if(item.model){ html = html + "<tr><td>Model</td><td>"+item.model+"</td></tr>" }
    
    item.extra.foreach((item) => {
        if(item[1]){ html = html + "<tr><td>"+item[0]+"</td><td>"+item[1]+"</td></tr>" }
    });

    html = html + "</table><br>"

    html = html + "<span style='color:red;font-weight:bold'>ALL FIREARMS MUST BE SHIPPED TO A CURRENT FEDERAL FIREARMS LICENSED DEALER (FFL DEALER)</span><br>"

    html = html + "<span>It is the buyer's responsibility to verify that this <b>" + item.manufacturer + " " + item.model + " " + item.upc + "</b> and its Accessories (Magazine, Etc.), are compliant <a href='https://www.statefirearmlaws.org/state-state-firearm-law-data' target='_blank'>in your state</a>.</span><br>";

    html = html + "<span>It is the buyer's responsibility to contact the FFL dealer to ensure they accept transfers, also a copy of their FFL is required to be emailed to <a href='mailto:sales@secguns.com'>sales@secguns.com</a>, before purchasing a firearm. Your order will not be fulfilled without a copy of their FFL.</span><br>";

    html = html + "<span>If you have any questions, please check out our <a href='https://secguns.com/faq/'><span style='color: #3366ff;'>FAQs</span></a> or <a href='https://secguns.com/buying-a-gun-online/'><span style='color: #3366ff;'>Buying A Gun Online</span></a> page.</span><br>";

    html = html + "<span style='font-size:10px;line-height:1em !important'>This product photo may not represent the complete detail of the item being purchased. Please verify the product based on the UPC #, description, and specifications before ordering.<br>Orders are shipped using the courier of SEC Gun's choice and are usually delivered to the customer's FFL dealer within 3-4 business days after shipment. It may take anywhere from 7-10 business days to complete the process and ship your firearm to the chosen FFL Dealer. All firearms, magazines, receivers and restricted law enforcement items are sold and shipped in accordance with all existing federal, state and local laws and regulations. Many of the firearms, magazines and parts for sale on SEC Guns website may be restricted or prohibited in the customer's area. It is the customer's sole responsibility to confirm local and state regulations before ordering. Federal firearm laws prevent the sale of a firearm from any licensed dealer directly to an individual in another state. All firearms, or regulated firearm accessories must be shipped to a Federal Firearms Licensed dealer. It is the customer's sole responsibility to choose an FFL dealer to ship to.</span>"

    return html;
}

export default descriptionGenerator;