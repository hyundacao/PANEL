export type TechnologyQuickReferenceProduct = {
  included: boolean;
  productIndex: string;
  productName: string;
  technologyName: string;
  materials: readonly { code: string; name: string }[];
  linkedProducts: readonly { productIndex: string; productName: string }[];
};

export type TechnologyQuickReferenceRow = {
  productIndex: string;
  productName: string;
  technologyName: string;
  componentCode: string;
  componentName: string;
};

/** One row per distinct direct component of each included plan item; no quantities. */
export const buildTechnologyQuickReferenceRows = (
  products: readonly TechnologyQuickReferenceProduct[]
): TechnologyQuickReferenceRow[] => {
  const rows: TechnologyQuickReferenceRow[] = [];

  for (const product of products) {
    if (!product.included) continue;
    const components = new Map<string, { code: string; name: string }>();
    const addComponent = (rawCode: string, rawName: string) => {
      const code = rawCode.trim();
      const name = rawName.trim();
      if (!code && !name) return;
      const key = code ? `code:${code.toLocaleLowerCase('pl')}` : `name:${name.toLocaleLowerCase('pl')}`;
      if (!components.has(key)) components.set(key, { code, name });
    };

    product.materials.forEach((material) => addComponent(material.code, material.name));
    product.linkedProducts.forEach((linked) => addComponent(linked.productIndex, linked.productName));

    if (components.size === 0) {
      rows.push({
        productIndex: product.productIndex.trim(),
        productName: product.productName.trim(),
        technologyName: product.technologyName,
        componentCode: '',
        componentName: ''
      });
      continue;
    }

    components.forEach((component) => rows.push({
      productIndex: product.productIndex.trim(),
      productName: product.productName.trim(),
      technologyName: product.technologyName,
      componentCode: component.code,
      componentName: component.name
    }));
  }

  return rows;
};
