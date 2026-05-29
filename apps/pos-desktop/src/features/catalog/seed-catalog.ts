import type {
  IsoDateTimeString,
  Product,
  ProductCategory,
  ProductCategoryId,
  ProductId,
} from "@packages/shared-types";

const seededAt = "2026-01-01T00:00:00.000Z" as IsoDateTimeString;

export const seedCategories: ProductCategory[] = [
  {
    id: "category-burgers" as ProductCategoryId,
    name: "Burgers",
    sortOrder: 1,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  },
  {
    id: "category-sandwiches" as ProductCategoryId,
    name: "Sandwiches",
    sortOrder: 2,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  },
  {
    id: "category-drinks" as ProductCategoryId,
    name: "Drinks",
    sortOrder: 3,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  },
];

export const seedProducts: Product[] = [
  createSeedProduct("product-classic-burger", "BRG-001", "Classic Burger", 500, "category-burgers"),
  createSeedProduct("product-double-burger", "BRG-002", "Double Burger", 750, "category-burgers"),
  createSeedProduct(
    "product-chicken-sandwich",
    "SND-001",
    "Chicken Sandwich",
    450,
    "category-sandwiches"
  ),
  createSeedProduct("product-fries", "SID-001", "Fries", 250, "category-sandwiches"),
  createSeedProduct("product-cola", "DRK-001", "Cola", 150, "category-drinks"),
];

export function listActiveProducts(products: Product[] = seedProducts): Product[] {
  return filterActiveProducts(products);
}

export interface ProductCatalogFilter {
  categoryId?: ProductCategoryId | undefined;
  searchTerm?: string | undefined;
}

export function filterActiveProducts(
  products: Product[] = seedProducts,
  filter: ProductCatalogFilter = {}
): Product[] {
  const normalizedSearch = filter.searchTerm?.trim().toLowerCase() ?? "";

  return products.filter((product) => {
    const matchesCategory = !filter.categoryId || product.categoryId === filter.categoryId;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      product.name.toLowerCase().includes(normalizedSearch) ||
      product.sku.toLowerCase().includes(normalizedSearch);

    return product.isActive && matchesCategory && matchesSearch;
  });
}

function createSeedProduct(
  id: string,
  sku: string,
  name: string,
  priceDZD: number,
  categoryId: string
): Product {
  return {
    id: id as ProductId,
    sku,
    name,
    priceDZD,
    vatRate: 0,
    categoryId: categoryId as ProductCategoryId,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  };
}
