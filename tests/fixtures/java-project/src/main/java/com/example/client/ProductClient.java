package com.example.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(name = "product-service", url = "http://localhost:8080")
public interface ProductClient {

    @GetMapping("/products/{id}")
    Product getProduct(@PathVariable("id") Long id);

    @GetMapping("/products")
    List<Product> getAllProducts();
}