// shadcn/ui 惯例的类名合并工具(CLI 生成组件假定 @app/utils/cn 存在)。
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
