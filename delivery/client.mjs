// Hatter downstream 2026: one installed trusted renderer for every product Scene.
import {startDelivery} from '@hathq/delivery-client'
const root=document.getElementById('app')
try{startDelivery(root,JSON.parse(document.getElementById('delivery-state').textContent))}
catch(error){root.replaceChildren();const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.code??'DeliveryUnavailable';root.append(message);root.setAttribute('aria-busy','false')}
