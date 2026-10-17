import { GadgetList, RechargePanel } from './Gadgets';

export { Charges } from './Gadgets';

/** Gadgets you can use here (the map, a shop: map and scrapbook gadgets), and paid recharging. */
export function GadgetPanel() {
  return (
    <>
      <GadgetList title="Use a gadget here" />
      <RechargePanel />
    </>
  );
}
