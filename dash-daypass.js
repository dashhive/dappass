(function (exports) {
  "use strict";
  // logme && console.log(logme)
  function $(sel, el) {
    return (el || document).querySelector(sel);
  };
  
  /*
  function $$(sel, el) {
    return (el || document).querySelectorAll(sel);
  }
  */
  
  let QRCode = window.QRCode;
  
  let DashDayPass = {};
  DashDayPass._protectedContent = {};
  
  DashDayPass._msDay = 24 * 60 * 60 * 1000;
  DashDayPass._satoshis = 100 * 1000 * 1000;
  DashDayPass._toSatoshis = function (value) {
    return Math.round(parseFloat(value) * DashDayPass._satoshis);
  };
  DashDayPass._toClipboard = function (string){
    navigator.clipboard.writeText(string)
  };

  DashDayPass.create = async function ({ addresses, plans , content}) {
    // TODO pro-rate payments that are between plans
    let contentSelector = content;

    if(!addresses.length){
      throw new Error('No Dash payment addresess provided')
    };
    let addressIndex = Math.floor(Math.random() * addresses.length);
    let address = addresses[addressIndex];

    if (!plans) {
      plans = [
        {
          amount: 0.0001,
          duration: 24 * 60 * 60 * 1000,
        },
        {
          amount: 0.001,
          duration: 10 * 24 * 60 * 60 * 1000,
        },
      ];
    };
    DashDayPass._fingerprint({ address, plans });

    DashDayPass._address = address;
    // Which address?
    console.log("address", address);

    DashDayPass._initStorage();

    /*
    localStorage.setItem('dash-daypass-tx', JSON.stringify({
      id: 'fdf77315af837dc8d7294d5f6e66174a95cbb470ffd5e0e346532bfda87bff9c'
    }));
    */

    let isPaid = await DashDayPass._checkPass({ plans, address });
    if (!isPaid) {
      DashDayPass._listenTxLock({ address, plans });
      onDomReady(function () {
        DashDayPass._addPaywall({ address, plans , contentSelector});
      });
    }
  };

  DashDayPass._fingerprint = async function ({ address, plans }) {
    plans.forEach(function (plan) {
      let amount = plan.amount;//plans[0].amount;
      let leeway = amount * (plans[0].leeway || 0.01);

      let fingerprint = Math.random() * leeway;
      amount -= fingerprint;

      // TODO check both
      plan.lastFingerprint = plan.fingerprint;
      plan.lastFingerprintSatoshis = plan.fingerprintSatoshis;
      plan.fingerprint = amount.toFixed(8);
      console.log('fingerprint',plan.fingerprint)
      plan.fingerprintSatoshis = DashDayPass._toSatoshis(plan.fingerprint);
      console.log("DEBUG satoshis:", plan.fingerprintSatoshis);

      plan.dashUri = `dash:${address}?amount=${plan.fingerprint}`;
      plan.svg = new QRCode({
        content: plan.dashUri,
        padding: 3,
        width: 256,
        height: 256,
        join:true,
        container: "svg-viewbox",
        color: "#000000",
        background: "#ffffff",
        ecl: "M",
      }).svg();
    });
    console.log("DEBUG plans:", plans);
  };

  DashDayPass._storage = null;

  DashDayPass._initStorage = function () {
    try {
      localStorage.getItem("doesntexist");
      DashDayPass._storage = localStorage;
    } catch (e) {
      try {
        sessionStorage.getItem("doesntexist");
        DashDayPass._storage = sessionStorage;
      } catch (e) {
        // ignore
      }
      DashDayPass._storageWarning =
        "We can't track your payment in private browser mode";
      
      console.log(DashDayPass._storageWarning)
    }
  };

  DashDayPass._checkPass = async function ({ address, plans }) {
    let tx = DashDayPass._getTxToken();
    if (!tx) {
      return;
    }

    let txData = await DashDayPass._getTxData(tx, address);

    let isValid = plans.some(function (plan) {
      return DashDayPass._paymentSatisfiesPlan(plan, txData);
    });
    if (!isValid) {
      console.log(
        `DEBUG: tx token is expired or does not meet minimum payment requirements`
      );
    }

    return isValid;
  };

  DashDayPass._getTxToken = function () {
    let db = DashDayPass._storage;
    if (!db) {
      console.log(`DEBUG: no storage`);
      return;
    }

    let txJson = db.getItem("dash-daypass-tx") || null;

    let tx;
    try {
      tx = JSON.parse(txJson);
    } catch (e) {
      console.warn(`Invalid transaction: ${txJson}`);
    }

    if (!tx?.id) {
      console.log(`DEBUG: no tx.id`);
      return;
    }

    return tx;
  };

  DashDayPass._getTxData = async function (tx, address) {
    // check storage and request tx
    //window.fetch(`https://insight.dash.org/insight-api/txs?address=${address}&pageNum=0`);
    let resp = await window.fetch(
      `https://insight.dash.org/insight-api/tx/${tx.id}`
    );
    let txData = await resp.json();
    if (!txData?.time) {
      console.log(`DEBUG: no txData.time`);
      return;
    }

    // How much?
    let spent = 0;
    txData.vout.forEach(function (vout) {
      let hasAddress = vout.scriptPubKey.addresses.includes(address);
      if (!hasAddress) {
        return;
      }

      let value = DashDayPass._toSatoshis(vout.value);
      spent += value;
    });
    console.log("spent", (spent / DashDayPass._satoshis).toFixed(8));

    // How old?
    let now = Date.now();
    let then = txData.time * 1000;
    let duration = now - then;
    console.log("how old?", duration);

    return {
      payment: spent,
      duration: duration,
    };
  };

  DashDayPass._paymentSatisfiesPlan = function (plan, txData) {
    let isAboveThreshold = txData.payment >= plan.amount;
    if (!isAboveThreshold) {
      return false;
    }

    let isExpired = txData.duration > plan.duration;
    if (isExpired) {
      return false;
    }

    return true;
  };

  DashDayPass._getProtectedContent = function(selector){
    let selectors = [selector,'dash-daypass-protect', '.dash-daypass-protect'];
    for (let sel of selectors) {
      if([
        '0', ''
      ].includes(sel)){
        continue
      };
      let content = $(sel);
      if(content){
        return content
      };
    }

    throw new Error('Unable to locate content');
  }

  DashDayPass._position = "";
  DashDayPass._addPaywall = function ({ address, plans , contentSelector}) {
    $('head').insertAdjacentHTML("beforeEnd", DashDayPassAssets.css);

    DashDayPass._protectedContent = DashDayPass._getProtectedContent(contentSelector);
    let _protectedContent = DashDayPass._protectedContent;

    let plansHtmlStr = plans.map(function(plan){
      let durationDays = plan.duration / DashDayPass._msDay;
      let durationLabel = 'day';
      if(1 < durationDays){
        durationLabel+='s'
      }
      return `
      <div class="dash-daypass-plan">
        <h3>Đ${plan.amount} for ${durationDays} ${durationLabel}. *</h3>
        <div class="dash-daypass_QR-wrapper">
          <fig class="dash-daypass_QR"> 
            <a class="dash-daypass_QR-link" href="${plan.dashUri}">
              ${plan.svg}
            </a>
          </fig>
          <div class="dash-daypass_QR-unhide-button">
            <span>Show&nbsp;</span>
              <div class="dash-daypass_dashlogo">
                ${DashDayPassAssets.dashLogoSvg}
              </div>
            <span>&nbsp;QR</span>
          </div>
        </div>
        <p>Pay your fingerprinted amount ( <strong>Đ${plan.fingerprint}</strong> ) to:</p>
        <div class="dash-daypass_payment">
          <a href="${plan.dashUri}">${address}</a>
          <button type="button" class="dash-daypass_copy-button" onclick="DashDayPass._copyPaymentAddress('${plan.dashUri}')">
            ${DashDayPassAssets.copyButtonSvg}
          </button>
        </div>
      </div>
      `
    }).join('');
    let paywallHTML = `
        <dash-daypass>
            <div class="dash-daypass_gradient"></div>
            <div class="dash-daypass_body">
              <h3 class="dash-daypass-center">Unlock this content for just:</h3>
              <div class="dash-daypass-plans-container">
                ${plansHtmlStr}
              </div>
              <small class="dash-daypass-center">* all payments are reduced by a small fingerprint to anonymously attach the payment to your device.</small>
              <small class="dash-daypass-center">Transaction fingerprints are not transferrable between devices.</small>
            </div>
        </dash-daypass>
			`
    _protectedContent.insertAdjacentHTML(
      'beforebegin',
      paywallHTML
    );
    _protectedContent.remove();
  };

  DashDayPass.removePaywall = function () {
    let paywallElement = $("dash-daypass-paywall");
    paywallElement.insertAdjacentHTML(
      'beforebegin',
      DashDayPass._protectedContent//.innerHTML
    );
    paywallElement.remove();
  };

  DashDayPass._listenTxLock = async function ({ address, plans }) {
    let eventToListenTo = "txlock";
    let room = "inv";

    // TODO use WebSockets instead
    var socket = window.io("https://insight.dash.org/");
    socket.on("connect", function () {
      // Join the room.
      socket.emit("subscribe", room);
    });
    socket.on(eventToListenTo, function (data) {
      // TODO limit time to 5 minutes?
      // console.log(`DEBUG: txlock`, data);
      // look for address

      /*
      {
        txid: "a920ba9fbf362f463fb2999aa4828909b9ba8564e7ac4911eb5471cca554d168",
        valueOut: 0.00500005,
        vout: [
          { XjAbAdPjKccAZAmBQ1iVwLG59QrLvaAQga: 100001 },
        ],
        isRBF: false,
        txlock: true,
      };
      */

      let txid = "";
      data.vout.some(function (vout) {
        return Object.keys(vout).some(function (addr) {
          if (addr !== address) {
            return false;
          }
          console.info("Found matching address:", addr);

          let payment = vout[addr];
          if (
            plans[0].fingerprintSatoshis !== payment &&
            plans[0].lastFingerprintSatoshis !== payment
          ) {
            return false;
          }
          console.info("Found matching payment:", payment);

          txid = data.txid;
          return true;
        });
      });

      if (!txid) {
        return;
      }

      let db = DashDayPass._storage;
      if (!db) {
        return;
      }

      db.setItem("dash-daypass-tx", JSON.stringify({ id: txid }));
      DashDayPass.removePaywall();
    });
  };

  function onDomReady(cb) {
    if (document.readyState === "loading") {
      // The document is still loading
      document.addEventListener("DOMContentLoaded", function (e) {
        cb();
      });
      return;
    }

    // The document is loaded completely
    cb();
  }

  exports.DashDayPass = DashDayPass;
})("undefined" === typeof module ? window : module.exports);












var DashDayPassAssets = {};
DashDayPassAssets.copyButtonSvg = `<svg 
    version="1.1"
    xmlns="http://www.w3.org/2000/svg" 
	  viewBox="0 0 460 460"
    width="100%" height="100%"
    stroke='currentcolor'
    fill='currentcolor'
    >
		<g>
			<path 
      d="M425.934,0H171.662c-18.122,0-32.864,14.743-32.864,32.864v77.134h30V32.864c0-1.579,1.285-2.864,2.864-2.864h254.272
				c1.579,0,2.864,1.285,2.864,2.864v254.272c0,1.58-1.285,2.865-2.864,2.865h-74.729v30h74.729
				c18.121,0,32.864-14.743,32.864-32.865V32.864C458.797,14.743,444.055,0,425.934,0z"/>
			<path 
      d="M288.339,139.998H34.068c-18.122,0-32.865,14.743-32.865,32.865v254.272C1.204,445.257,15.946,460,34.068,460h254.272
				c18.122,0,32.865-14.743,32.865-32.864V172.863C321.206,154.741,306.461,139.998,288.339,139.998z M288.341,430H34.068
				c-1.58,0-2.865-1.285-2.865-2.864V172.863c0-1.58,1.285-2.865,2.865-2.865h254.272c1.58,0,2.865,1.285,2.865,2.865v254.273h0.001
				C291.206,428.715,289.92,430,288.341,430z"/>
		</g>
</svg>`;
DashDayPassAssets.dashLogoSvg = `<svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%" height="100%"
      viewBox="0 0 64 64"
    >
      <path id="Imported Path"
        fill="#1E75BB" stroke="none" stroke-width="1"
        d="M 26.22,27.62
           C 26.22,27.62 3.11,27.62 3.11,27.62
             3.11,27.62 0.00,36.26 0.00,36.26
             0.00,36.26 23.36,36.26 23.36,36.26
             23.36,36.26 26.22,27.62 26.22,27.62 Z
           M 63.93,19.11
           C 63.87,18.05 63.56,16.93 63.00,16.00
             62.50,15.01 61.63,14.26 60.64,13.89
             59.58,13.39 58.46,13.14 57.28,13.14
             57.28,13.14 13.85,13.14 13.85,13.14
             13.85,13.14 10.75,22.46 10.75,22.46
             10.75,22.46 50.07,22.46 50.07,22.46
             50.07,22.46 43.86,41.54 43.86,41.54
             43.86,41.54 4.54,41.54 4.54,41.54
             4.54,41.54 1.43,50.86 1.43,50.86
             1.43,50.86 45.04,50.86 45.04,50.86
             46.35,50.79 47.65,50.55 48.83,50.11
             50.07,49.43 51.44,48.74 52.62,47.75
             53.80,46.82 54.80,45.82 55.73,44.64
             56.47,43.46 57.10,42.28 57.65,41.04
             57.65,41.04 63.43,22.96 63.43,22.96
             63.93,21.72 64.12,20.35 63.93,19.11 Z" />
    </svg>`;
DashDayPassAssets.css = "<style>" + `:root {
    --color-dash-daypass-brand: #1E75BB;
    --color-dash-daypass-bg: rgba(255, 255, 255);
    --color-dash-daypass-bg-50:rgba(255, 255, 255, 0.8);
    --color-dash-daypass-shadow: #f4f4f4;
    --color-dash-daypass-text: #000;
    --color-dash-daypass-text-secondary: #999;
    --font-family-dash-daypass: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    
    --bg-elevation-1:rgba(0,0,0,0.03);
    --shadow-elevation-1:rgba(0,0,0,0.1);
    
    --brightness-dash-daypass-hover: brightness(1.55);
    --brightness-dash-daypass-qr: brightness(0.98);
}

@media (prefers-color-scheme: dark) {
    :root {
        --color-dash-daypass-bg: rgba(51, 51, 51);
        --color-dash-daypass-bg-50:rgba(51, 51, 51, 0.8);
        --color-dash-daypass-shadow: #bbbbbb20;
        --color-dash-daypass-text: rgba(240, 240, 240);
        --color-dash-daypass-text-secondary: #aaa;

        --bg-elevation-1:rgba(255,255,255,0.02);
        --shadow-elevation-1:rgba(0,0,0,0.12);

        --brightness-dash-daypass-qr: brightness(0.9);
    }
}
dash-daypass{
  background-color: rgba(0,0,0,0);
  height: 100%;
  width: 100%;
  font-size: 1.0em;
  font-family: var(--font-family-dash-daypass);
  line-height: 1.5;
}

dash-daypass a {
    color: var(--color-dash-daypass-brand);
    filter: brightness(1.2);
    display: inline-block;
    font-weight: bold;
    text-decoration: none;
}
dash-daypass a:hover{
  filter: var(--brightness-dash-daypass-hover);
  text-decoration: underline;
}
.dash-daypass_body{
  width: 100%;
  background-color: var(--color-dash-daypass-bg);
  color: var(--color-dash-daypass-text);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.dash-daypass-center{
  text-align: center;
}
.dash-daypass-plans-container{
  width: 100%;
  display: flex;
  overflow-x: scroll;
}
.dash-daypass-plan{
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin: 0 20px 1rem;
  padding: 5px;
  background-color: var(--bg-elevation-1);
  box-shadow: var(--box-shadow) var(--shadow-elevation-1);
  width:min-content;
}
.dash-daypass-plan:first-child{
  margin-left: auto;
}
.dash-daypass-plan:last-child{
  margin-right: auto;
}
.dash-daypass-plan p {
  margin: 0 1rem;
  width: max-content;
}
.dash-daypass a {
  font-weight: 500;
}
.dash-daypass-plan h3 {
  text-align: center;
  margin: 0;
  font-size: 1.4em;
}
.dash-daypass_QR-wrapper{
  width:100%;
  display: flex;
  justify-content: center;
}
.dash-daypass_QR{
  margin: 1em;
  min-width: 250px;
  filter: var(--brightness-dash-daypass-qr);
}
.dash-daypass_QR-link {
  width: 100%;
}

.dash-daypass small {
    color: var(--color-dash-daypass-text-secondary);
}
.dash-daypass_QR-unhide-button{
  display:none;
}

.dash-daypass_payment{
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}
dash-daypass .dash-daypass_copy-button {
  width: 2rem;
  height: 2rem;
  margin: 0 0.5rem 0.5rem 0.7rem;
  padding: 0.2rem;
  background-color: var(--color-dash-daypass-bg);
  color: var(--color-dash-daypass-text);
  opacity: 0.6;
  border: solid 0.1rem var(--color-dash-daypass-text);
  border-radius: 0.3rem;
}


@media screen and (max-width: 1000px){
  dash-daypass{
    font-size: 1.5em;
  }
  .dash-daypass-plans-container{
    flex-direction: column;
    align-items: center;
  }
  .dash-daypass-plan{
    width: 90%;
  }
  .dash-daypass-plan p {
    display: inline;
    width: max-content;
    text-align: center;
  }

  dash-daypass a {
    font-size: 3.5vw;
  }

  .dash-daypass_QR-unhide-button{
    display: flex;
    align-items: center;
    width:fit-content;
    padding: 0.4em 0.8em;
    font-size: 1.4em;
    border: solid 0.1em var(--color-dash-daypass-brand);
    border-radius: 0.7em;

  }
  .dash-daypass_dashlogo{
    display: inline-block;
    height: 1.2em;
  }
  .dash-daypass_QR{
    display:none;
  min-width: 400px;
  }
  .dash-daypass_QR-wrapper{
    width:fit-content;
  }
  .dash-daypass_QR-wrapper:hover .dash-daypass_QR-unhide-button{
    display: none;
  }
  .dash-daypass_QR-wrapper:hover .dash-daypass_QR{
    display: inherit;
  }

  .dash-daypass_payment{
    align-items: flex-start;
  }
}` + "</style>";
