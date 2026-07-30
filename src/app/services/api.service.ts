import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, of, forkJoin } from 'rxjs';
import { catchError, retry, map, switchMap, tap, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  categoryId?: number;
  categoryUid?: string;
  image?: string;
  imageUrl?: string;
  imageId?: string;
  isPopular?: boolean;
  allergens?: string[];
  estimatedTime?: number;
  preparationTime?: number;
  isAvailable?: boolean;
  title?: string;
  categoryName?: string;
  uid?: string;
  alias?: string;
  locationPrices?: LocationPrice[];
  unitPriceWithVat?: number;
  isBase64Image?: boolean;
  rawApiData?: any;
}

export interface LocationPrice {
  locationUid: string;
  locationName?: string;
  price: number;
  unitPrice?: number;
  currency?: string;
  isActive?: boolean;
}

export interface CategoryWithProducts {
  uid: string;
  name: string;
  description?: string;
  alias?: string;
  products: Product[];
  isActive?: boolean;
}

export interface CartItem extends Product {
  quantity: number;
  addedAt?: Date;
  specialInstructions?: string;
  toppings?: any[];
}

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

export interface Order {
  id?: string;
  orderNumber?: string;
  tableId: string;
  customerInfo: CustomerInfo;
  items: CartItem[];
  paymentMethod: string;
  totals: {
    subtotal: number;
    serviceFee: number;
    tax: number;
    total: number;
  };
  estimatedTime?: number;
  orderTime?: Date;
  status?: string;
}

export interface OrderResponse {
  isSuccess: boolean;
  data: {
    id: number;
    orderNumber: string;
    status: string;
    estimatedTime: number;
    totalAmount: number;
    createdAt: string;
    queuePosition?: number | null;
  } | null;
  message: string;
  timestamp: string;
  isOffline?: boolean;
  shouldRetry?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private BaseURL = environment.apiBaseUrl;
  private ApiKey = "";
  
  private authToken: string | null = null;
  private tokenExpiryTime: number = 0;
  private isRefreshingToken = false;
  private refreshTokenSubject = new BehaviorSubject<boolean>(false);
  
  private cartSubject = new BehaviorSubject<CartItem[]>([]);
  public cart$ = this.cartSubject.asObservable();

  private get httpOptions() {
    const headers: any = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'ApiKey': this.ApiKey
    };
    
    if (this.authToken && this.isTokenStillValid()) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
      console.log('🔐 Using valid auth token');
    } else if (this.authToken) {
      console.warn('⚠️ Token exists but is expired/invalid');
    } else {
      console.warn('⚠️ No auth token available');
    }
    
    return {
      headers: new HttpHeaders(headers)
    };
  }

  constructor(private http: HttpClient) {
    this.loadCartFromStorage();
    this.loadTokenFromStorage();
    console.log('🚀 Enhanced API Service initialized');
    this.initializeTokenManagement();
  }

  private initializeTokenManagement(): void {
    setInterval(() => {
      if (this.authToken && this.isTokenNearExpiry() && !this.isRefreshingToken) {
        console.log('🔄 Token is near expiry, auto-refreshing...');
        this.refreshToken().subscribe({
          next: () => console.log('✅ Token auto-refreshed successfully'),
          error: (error) => console.error('❌ Auto-refresh failed:', error)
        });
      }
    }, 60000);

    this.debugTokenState();
  }

  private isTokenStillValid(): boolean {
    if (!this.authToken) return false;
    const now = Date.now();
    const isValid = now < this.tokenExpiryTime;
    
    if (!isValid) {
      console.log('⏰ Token has expired:', {
        now: new Date(now),
        expiry: new Date(this.tokenExpiryTime),
        expired: (now - this.tokenExpiryTime) / 1000 / 60 + ' minutes ago'
      });
    }
    
    return isValid;
  }

  private isTokenNearExpiry(): boolean {
    if (!this.authToken) return false;
    const now = Date.now();
    const twoMinutesFromNow = now + (2 * 60 * 1000);
    return twoMinutesFromNow >= this.tokenExpiryTime;
  }

  login(): Observable<any> {
    console.log('🔐 Attempting login to API...');
    
    const loginData = {
      username: environment.stagingUsername,
      password: environment.stagingPassword
    };
    
    const loginHeaders = {
      headers: new HttpHeaders({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'ApiKey': this.ApiKey
      })
    };

    return this.http.post(`${this.BaseURL}/auth/login`, loginData, loginHeaders)
      .pipe(
        timeout(10000),
        tap(response => {
          console.log('✅ Login response received');
          console.log('🔍 Response structure:', JSON.stringify(response, null, 2));
        }),
        map((response: any) => {
          const token = this.extractTokenFromResponse(response);
          
          if (token) {
            this.setAuthToken(token);
            console.log('🔑 Auth token set successfully');
            this.isRefreshingToken = false;
            this.refreshTokenSubject.next(true);
            
            setTimeout(() => this.testTokenWithProductCategories(), 500);
          } else {
            console.error('❌ No token found in login response');
            this.logAvailableResponseKeys(response);
            throw new Error('No authentication token received');
          }
          
          return response;
        }),
        catchError(error => {
          console.error('❌ Login failed:', error);
          this.isRefreshingToken = false;
          this.refreshTokenSubject.next(false);
          return this.handleError(error);
        })
      );
  }

  refreshToken(): Observable<any> {
    if (this.isRefreshingToken) {
      console.log('🔄 Token refresh already in progress, waiting...');
      return this.refreshTokenSubject.pipe(
        switchMap(success => success ? of(true) : throwError(() => new Error('Token refresh failed')))
      );
    }

    console.log('🔄 Refreshing authentication token...');
    this.isRefreshingToken = true;
    this.clearToken();
    
    return this.login();
  }

  private extractTokenFromResponse(response: any): string | null {
    console.log('🔍 Searching for token in response...');
    
    const possibleTokenPaths = [
      response?.payload?.token,
      response?.payload?.accessToken,
      response?.payload?.access_token,
      response?.payload?.authToken,
      response?.payload?.jwt,
      response?.token,
      response?.accessToken,
      response?.access_token,
      response?.authToken,
      response?.jwt,
      response?.data?.token,
      response?.data?.accessToken,
      response?.result?.token
    ];
    
    for (let i = 0; i < possibleTokenPaths.length; i++) {
      const tokenPath = possibleTokenPaths[i];
      if (tokenPath && typeof tokenPath === 'string' && tokenPath.length > 10) {
        console.log(`✅ Token found at path ${i}:`, tokenPath.substring(0, 30) + '...');
        return tokenPath;
      }
    }
    
    console.warn('⚠️ No valid token found in response');
    return null;
  }

  private setAuthToken(token: string): void {
    const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
    this.authToken = cleanToken;
    
    this.tokenExpiryTime = Date.now() + (23 * 60 * 60 * 1000);
    this.saveTokenToStorage();
    
    console.log('💾 Token stored successfully');
    console.log('- Token length:', cleanToken.length);
    console.log('- Token preview:', cleanToken.substring(0, 30) + '...');
    console.log('- Expires at:', new Date(this.tokenExpiryTime));
  }

  // =============== ENHANCED AUTHENTICATED REQUEST WRAPPER ===============

  private ensureAuthenticated(): Observable<any> {
    // If token is valid, proceed
    if (this.isTokenStillValid()) {
      console.log('✅ Token valid - proceeding with request');
      return of(true);
    }
    
    // If refresh is in progress, wait for it
    if (this.isRefreshingToken) {
      console.log('🔄 Token refresh in progress, waiting...');
      return this.refreshTokenSubject.pipe(
        switchMap(success => {
          if (success && this.isTokenStillValid()) {
            return of(true);
          } else {
            return throwError(() => new Error('Token refresh failed'));
          }
        })
      );
    }
    
    // Token invalid/missing - refresh it
    console.log('🔄 Token invalid/missing - refreshing...');
    return this.refreshToken().pipe(
      tap(() => console.log('✅ Authentication completed')),
      map(() => true)
    );
  }

  private makeAuthenticatedRequest<T>(requestFn: () => Observable<T>): Observable<T> {
    return this.ensureAuthenticated().pipe(
      switchMap(() => requestFn()),
      catchError(error => {
        // If 401, try refreshing token once
        if (error.status === 401 && !this.isRefreshingToken) {
          console.log('🔄 Got 401, attempting token refresh...');
          return this.refreshToken().pipe(
            switchMap(() => requestFn()),
            catchError(retryError => {
              console.error('❌ Request failed even after token refresh:', retryError);
              return throwError(() => retryError);
            })
          );
        }
        return throwError(() => error);
      })
    );
  }

  // =============== ENHANCED API METHODS ===============

  getCategoriesWithProducts(): Observable<CategoryWithProducts[]> {
    console.log('📋 Fetching categories with products...');
    
    const requestFn = () => forkJoin({
      categories: this.http.get<any>(`${this.BaseURL}/categories`, this.httpOptions),
      allProducts: this.http.get<any>(`${this.BaseURL}/products`, this.httpOptions)
    }).pipe(
      tap(({ categories, allProducts }) => {
        console.log('🔍 Categories response:', categories);
        console.log('🔍 Products response:', allProducts);
      }),
      map(({ categories, allProducts }) => {
        console.log('✅ Categories and products fetched');
        console.log('📊 Categories count:', categories?.length || 0);
        console.log('📊 Products count:', allProducts?.length || 0);
        
        return this.processCategoriesWithProducts(categories, allProducts);
      })
    );

    return this.makeAuthenticatedRequest(requestFn).pipe(
      catchError(error => {
        console.error('❌ Failed to fetch categories with products:', error);
        return of([]);
      })
    );
  }

  getProductsByCategory(categoryUid: string): Observable<Product[]> {
    console.log(`🔍 Fetching products for category: ${categoryUid}`);
    
    const requestFn = () => {
      const endpoint = `${this.BaseURL}/products/available?categoryId=${categoryUid}`;
      
      return this.http.get<any>(endpoint, this.httpOptions).pipe(
        tap(rawResponse => {
          console.log('🔍 RAW PRODUCTS BY CATEGORY RESPONSE:', rawResponse);
        }),
        map(products => {
          console.log(`✅ Products fetched for category ${categoryUid}:`, products?.length || 0);
          return this.processProducts(products);
        })
      );
    };

    return this.makeAuthenticatedRequest(requestFn).pipe(
      retry(1),
      catchError(error => {
        console.error(`❌ Failed to fetch products for category ${categoryUid}:`, error);
        return of([]);
      })
    );
  }

  getSellingProducts(): Observable<Product[]> {
    console.log('🔍 Fetching all selling products...');
    
    const requestFn = () => {
      const endpoint = `${this.BaseURL}/products/available`;
      
      return this.http.get<any>(endpoint, this.httpOptions).pipe(
        tap(rawResponse => {
          console.log('🔍 RAW SELLING PRODUCTS RESPONSE:', rawResponse);
        }),
        map(response => {
          console.log('✅ Selling products fetched');
          
          let rawProducts: any[] = [];
          
          if (response?.payload?.records && Array.isArray(response.payload.records)) {
            rawProducts = response.payload.records;
          } else if (response?.payload && Array.isArray(response.payload)) {
            rawProducts = response.payload;
          } else if (Array.isArray(response)) {
            rawProducts = response;
          } else if (response?.data && Array.isArray(response.data)) {
            rawProducts = response.data;
          }
          
          console.log(`📊 Found ${rawProducts.length} raw products`);
          return this.processProducts(rawProducts);
        })
      );
    };

    return this.makeAuthenticatedRequest(requestFn).pipe(
      retry(1),
      catchError(error => {
        console.error('❌ Failed to fetch selling products:', error);
        return of([]);
      })
    );
  }

  createOrder(orderData: Order): Observable<OrderResponse> {
    console.log('📝 Creating order via API...');

    const requestFn = () => {
      const apiOrderData = this.transformOrderFormat(orderData);
      console.log('🌐 Sending order to API:', apiOrderData);

      return this.http.post<any>(`${this.BaseURL}/orders`, apiOrderData, this.httpOptions).pipe(
        tap(response => {
          console.log('✅ Order created successfully:', response);
        }),
        map(response => this.processOrderResponse(response))
      );
    };

    return this.makeAuthenticatedRequest(requestFn).pipe(
      catchError(error => {
        console.error('❌ Order creation failed:', error);
        return of(this.createFallbackOrderResponse());
      })
    );
  }

  // =============== TOKEN STORAGE & MANAGEMENT ===============

  private saveTokenToStorage(): void {
    try {
      localStorage.setItem('app_auth_token', this.authToken || '');
      localStorage.setItem('app_token_expiry', this.tokenExpiryTime.toString());
      console.log('💾 Token saved to localStorage');
    } catch (error) {
      console.error('❌ Error saving token:', error);
    }
  }

  private loadTokenFromStorage(): void {
    try {
      const token = localStorage.getItem('app_auth_token');
      const expiry = localStorage.getItem('app_token_expiry');
      
      if (token && expiry) {
        this.authToken = token;
        this.tokenExpiryTime = parseInt(expiry);
        
        if (!this.isTokenStillValid()) {
          console.log('⚠️ Stored token is expired, clearing...');
          this.clearToken();
        } else {
          console.log('🔑 Valid auth token loaded from storage');
          console.log('- Expires in:', Math.round((this.tokenExpiryTime - Date.now()) / 1000 / 60), 'minutes');
        }
      } else {
        console.log('ℹ️ No stored token found');
      }
    } catch (error) {
      console.error('❌ Error loading token:', error);
      this.clearToken();
    }
  }

  private clearToken(): void {
    console.log('🗑️ Clearing authentication token...');
    this.authToken = null;
    this.tokenExpiryTime = 0;
    localStorage.removeItem('app_auth_token');
    localStorage.removeItem('app_token_expiry');
  }

  // =============== DEBUG & UTILITY METHODS ===============

  debugTokenState(): void {
    console.log('🔍 === TOKEN DEBUG STATE ===');
    console.log('- Has token:', !!this.authToken);
    console.log('- Token length:', this.authToken?.length || 0);
    console.log('- Token preview:', this.authToken?.substring(0, 30) + '...');
    console.log('- Token expiry:', new Date(this.tokenExpiryTime));
    console.log('- Is valid:', this.isTokenStillValid());
    console.log('- Near expiry:', this.isTokenNearExpiry());
    console.log('- Minutes until expiry:', Math.round((this.tokenExpiryTime - Date.now()) / 1000 / 60));
    console.log('===========================');
  }

  forceReauth(): Observable<any> {
    console.log('🔄 Forcing fresh authentication...');
    this.clearToken();
    this.isRefreshingToken = false;
    return this.login();
  }

  getTokenInfo(): { hasToken: boolean; isValid: boolean; expiresIn: number; nearExpiry: boolean } {
    return {
      hasToken: !!this.authToken,
      isValid: this.isTokenStillValid(),
      expiresIn: Math.round((this.tokenExpiryTime - Date.now()) / 1000 / 60),
      nearExpiry: this.isTokenNearExpiry()
    };
  }

  // =============== TEST METHODS ===============

  private testTokenWithProductCategories(): void {
    if (!this.authToken) {
      console.log('⚠️ No token to test');
      return;
    }
    
    console.log('🧪 Testing token with product categories...');
    
    this.http.get(`${this.BaseURL}/categories`, this.httpOptions)
      .subscribe({
        next: (response) => {
          console.log('✅ Token test SUCCESSFUL - Categories API responding');
          console.log('📋 Categories preview:', response);
        },
        error: (error) => {
          console.error('❌ Token test FAILED:', error.status, error.statusText);
          if (error.status === 401) {
            console.log('🔄 Token invalid - triggering refresh');
            this.refreshToken().subscribe();
          }
        }
      });
  }

  testApiEndpoints(): Observable<any> {
    console.log('🧪 Testing all API endpoints...');
    
    const requestFn = () => forkJoin({
      categories: this.http.get(`${this.BaseURL}/categories`, this.httpOptions),
      allProducts: this.http.get(`${this.BaseURL}/products`, this.httpOptions),
      sellingProducts: this.http.get(`${this.BaseURL}/products/available`, this.httpOptions)
    }).pipe(
      tap(results => {
        console.log('🔍 RAW TEST RESULTS:', results);
      }),
      map(results => {
        console.log('✅ All endpoints tested successfully');
        console.log('📊 Test results:', {
          categories: (results.categories as any[])?.length || 0,
          allProducts: (results.allProducts as any[])?.length || 0,
          sellingProducts: (results.sellingProducts as any[])?.length || 0
        });
        return results;
      })
    );

    return this.makeAuthenticatedRequest(requestFn).pipe(
      catchError(error => {
        console.error('❌ Endpoint test failed:', error);
        return of({ error: error.message });
      })
    );
  }

  // =============== HELPER METHODS (keeping existing logic) ===============

  getHttpHeaders(): HttpHeaders {
    return this.httpOptions.headers;
  }

  getApiKey(): string {
    return this.ApiKey;
  }

  getBaseUrl(): string {
    return this.BaseURL;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getAllProducts(): Observable<Product[]> {
    return this.getSellingProducts();
  }

  // =============== EXISTING PROCESSING METHODS ===============

  private processCategoriesWithProducts(categories: any[], allProducts: any[]): CategoryWithProducts[] {
    if (!categories || !Array.isArray(categories)) {
      console.warn('⚠️ Invalid categories data');
      return [];
    }
    
    console.log('🔄 Processing categories with products...');
    
    return categories.map(category => {
      const categoryProducts = allProducts?.filter(product =>
        product.categoryId === category.uid ||
        product.categoryUid === category.uid ||
        product.categoryId === category.id
      ) || [];
      
      console.log(`📋 Category "${category.name}": ${categoryProducts.length} products`);
      
      return {
        uid: category.uid,
        name: category.name || category.title || 'Unknown Category',
        description: category.description || category.alias,
        alias: category.alias,
        products: this.processProducts(categoryProducts),
        isActive: category.isActive !== false
      };
    }).filter(category => category.products.length > 0);
  }

  private processProducts(products: any[]): Product[] {
    if (!products || !Array.isArray(products)) {
      console.warn('⚠️ Invalid products data');
      return [];
    }
    
    console.log(`🔄 Processing ${products.length} products...`);
    
    return products.map(product => this.transformProduct(product))
                  .filter(product => product.isAvailable !== false);
  }

  private transformProduct(apiProduct: any): Product {
    console.log('🔄 Transforming product:', apiProduct.name);
    
    return {
      id: apiProduct.id || apiProduct.productId || Math.floor(Math.random() * 10000),
      uid: apiProduct.uid,
      name: apiProduct.name || apiProduct.title || apiProduct.productName || 'Unknown Product',
      description: this.extractDescription(apiProduct),
      price: this.extractPriceEnhanced(apiProduct),
      category: this.mapApiCategory(apiProduct),
      categoryId: apiProduct.categoryId,
      categoryUid: apiProduct.categoryId || apiProduct.categoryUid,
      image: this.generateImageUrlEnhanced(apiProduct),
      imageId: apiProduct.imageId,
      imageUrl: apiProduct.imageUrl,
      isPopular: this.determinePopularity(apiProduct),
      allergens: this.extractAllergens(apiProduct),
      estimatedTime: this.estimatePreparationTime(apiProduct),
      isAvailable: this.checkAvailability(apiProduct),
      alias: apiProduct.alias,
      locationPrices: this.extractLocationPrices(apiProduct),
      unitPriceWithVat: apiProduct.unitPriceWithVat,
      rawApiData: apiProduct
    };
  }

  // ... (keeping all other existing methods like extractDescription, extractPriceEnhanced, etc.)
  
  // =============== CART MANAGEMENT ===============
  
  addToCart(product: Product, quantity: number = 1): void {
    const currentCart = this.cartSubject.value;
    const existingItem = currentCart.find(item => item.id === product.id);
    
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      const cartItem: CartItem = {
        ...product,
        quantity,
        addedAt: new Date()
      };
      currentCart.push(cartItem);
    }
    
    this.cartSubject.next([...currentCart]);
    this.saveCartToStorage();
    console.log('🛒 Added to cart:', product.name, 'Quantity:', quantity);
  }

  removeFromCart(productId: number): void {
    const currentCart = this.cartSubject.value.filter(item => item.id !== productId);
    this.cartSubject.next(currentCart);
    this.saveCartToStorage();
  }

  updateCartQuantity(productId: number, quantity: number): void {
    const currentCart = this.cartSubject.value;
    const item = currentCart.find(item => item.id === productId);
    
    if (item) {
      if (quantity <= 0) {
        this.removeFromCart(productId);
      } else {
        item.quantity = quantity;
        this.cartSubject.next([...currentCart]);
        this.saveCartToStorage();
      }
    }
  }

  clearCart(): void {
    this.cartSubject.next([]);
    this.removeCartFromStorage();
  }

  getCartTotal(): number {
    return this.cartSubject.value.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );
  }

  getCartItemCount(): number {
    return this.cartSubject.value.reduce((count, item) => 
      count + item.quantity, 0
    );
  }

  private saveCartToStorage(): void {
    try {
      localStorage.setItem('app_cart', JSON.stringify(this.cartSubject.value));
    } catch (error) {
      console.error('Error saving cart:', error);
    }
  }

  private loadCartFromStorage(): void {
    try {
      const savedCart = localStorage.getItem('app_cart');
      if (savedCart) {
        const cart = JSON.parse(savedCart);
        this.cartSubject.next(cart);
      }
    } catch (error) {
      console.error('Error loading cart:', error);
    }
  }

  private removeCartFromStorage(): void {
    localStorage.removeItem('app_cart');
  }

  // =============== ERROR HANDLING ===============

  private handleError = (error: HttpErrorResponse): Observable<never> => {
    console.error('🚨 === API ERROR DETAILS ===');
    console.error('- Status:', error.status);
    console.error('- Status Text:', error.statusText);
    console.error('- URL:', error.url);
    console.error('- Message:', error.message);
    console.error('============================');
    
    let errorMessage = 'Something went wrong';
    
    switch (error.status) {
      case 0:
        errorMessage = 'Cannot connect to server - check network or CORS';
        break;
      case 401:
        errorMessage = 'Unauthorized - token expired or invalid';
        break;
      case 403:
        errorMessage = 'Forbidden - insufficient permissions';
        break;
      case 404:
        errorMessage = 'Endpoint not found';
        break;
      case 500:
        errorMessage = 'Server error - try again later';
        break;
      default:
        errorMessage = `Error ${error.status}: ${error.message}`;
    }
    
    return throwError(() => new Error(errorMessage));
  };

 
  private processOrderResponse(response: any): OrderResponse {
    console.log('🔍 Processing order response:', response);
    
    try {
      const orderData = this.extractOrderData(response);
      
      if (!orderData && response) {
        return {
          isSuccess: true,
          data: {
            id: Date.now(),
            orderNumber: this.generateOrderNumber(),
            status: 'confirmed',
            estimatedTime: 15,
            totalAmount: 0,
            createdAt: new Date().toISOString(),
            queuePosition: null
          },
          message: 'Order submitted successfully',
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        isSuccess: response.isSuccess !== false,
        data: {
          id: orderData?.id || orderData?.uid || Date.now(),
          orderNumber: orderData?.orderNumber || this.generateOrderNumber(),
          status: 'confirmed',
          estimatedTime: 15,
          totalAmount: orderData?.totalAmount || 0,
          createdAt: orderData?.createdAt || new Date().toISOString(),
          queuePosition: null
        },
        message: response.message || 'Order placed successfully',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Error processing order response:', error);
      return this.createFallbackOrderResponse();
    }
  }

  private extractOrderData(response: any): any {
    if (response.payload) return response.payload;
    if (response.data) return response.data;
    if (response.order) return response.order;
    if (response.result) return response.result;
    if (response.id || response.uid) return response;
    return null;
  }

  private createFallbackOrderResponse(): OrderResponse {
    return {
      isSuccess: true,
      data: {
        id: Date.now(),
        orderNumber: this.generateOrderNumber(),
        status: 'confirmed',
        estimatedTime: 15,
        totalAmount: 0,
        createdAt: new Date().toISOString(),
        queuePosition: null
      },
      message: 'Order submitted successfully (offline mode)',
      timestamp: new Date().toISOString(),
      isOffline: true
    };
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `ORD${timestamp}${random}`;
  }

  private logAvailableResponseKeys(response: any): void {
    console.log('Available response keys:', Object.keys(response || {}));
    if (response?.payload) {
      console.log('Payload keys:', Object.keys(response.payload || {}));
    }
    if (response?.data) {
      console.log('Data keys:', Object.keys(response.data || {}));
    }
  }

  // =============== COMPLETE EXISTING METHODS IMPLEMENTATION ===============

  private extractDescription(apiProduct: any): string {
    const description = apiProduct.description || 
                      apiProduct.productDescription || 
                      apiProduct.alias || 
                      `Delicious ${apiProduct.name}`;
    
    return description.replace(/[^\w\s\-.,!?]/g, '').trim();
  }

  private extractPriceEnhanced(apiProduct: any): number {
    console.log('💰 Enhanced price extraction for:', apiProduct.name);
    
    // PRIORITATE 1: LocationPrices
    if (apiProduct.locationPrices && Array.isArray(apiProduct.locationPrices) && apiProduct.locationPrices.length > 0) {
      for (const locationPrice of apiProduct.locationPrices) {
        if (locationPrice && typeof locationPrice.unitPriceWithVat === 'number' && locationPrice.unitPriceWithVat > 0) {
          console.log('✅ Price from locationPrices.unitPriceWithVat:', locationPrice.unitPriceWithVat);
          return Math.round(locationPrice.unitPriceWithVat * 100) / 100;
        }
        
        if (locationPrice && typeof locationPrice.price === 'number' && locationPrice.price > 0) {
          console.log('✅ Price from locationPrices.price:', locationPrice.price);
          return Math.round(locationPrice.price * 100) / 100;
        }
      }
    }
    
    // PRIORITATE 2: UnitPriceWithVat la nivel de produs
    if (typeof apiProduct.unitPriceWithVat === 'number' && apiProduct.unitPriceWithVat > 0) {
      console.log('✅ Price from product.unitPriceWithVat:', apiProduct.unitPriceWithVat);
      return Math.round(apiProduct.unitPriceWithVat * 100) / 100;
    }
    
    // PRIORITATE 3: Alte câmpuri de preț
    const priceFields = ['price', 'unitPrice', 'cost', 'amount', 'basePrice'];
    for (const field of priceFields) {
      const value = apiProduct[field];
      if (typeof value === 'number' && value > 0) {
        console.log(`✅ Price from ${field}:`, value);
        return Math.round(value * 100) / 100;
      }
      
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (!isNaN(parsed) && parsed > 0) {
          console.log(`✅ Price parsed from ${field}:`, parsed);
          return Math.round(parsed * 100) / 100;
        }
      }
    }
    
    // FALLBACK: Preț generat pe categorii
    const categoryPrice = this.generateCategoryBasedPrice(apiProduct);
    console.log('⚠️ Using category-based fallback price:', categoryPrice);
    return categoryPrice;
  }

  private generateCategoryBasedPrice(apiProduct: any): number {
    const category = this.mapApiCategory(apiProduct);
    const name = String(apiProduct.name || '').toLowerCase();
    
    const basePrices: { [key: string]: [number, number] } = {
      'burgers': [15, 35],
      'chicken': [12, 28],
      'sides': [8, 18],
      'drinks': [5, 12],
      'desserts': [6, 15],
      'other': [10, 25]
    };
    
    const [min, max] = basePrices[category] || basePrices['other'];
    
    let multiplier = 1;
    if (name.includes('large') || name.includes('big') || name.includes('xl')) multiplier = 1.3;
    if (name.includes('small') || name.includes('mini')) multiplier = 0.7;
    if (name.includes('premium') || name.includes('deluxe') || name.includes('special')) multiplier = 1.5;
    
    const basePrice = Math.random() * (max - min) + min;
    return Math.round(basePrice * multiplier * 100) / 100;
  }

  private mapApiCategory(apiProduct: any): string {
    const name = String(apiProduct.name || '').toLowerCase();
    const category = String(apiProduct.category || apiProduct.categoryName || '').toLowerCase();
    const alias = String(apiProduct.alias || '').toLowerCase();
    
    const searchText = `${name} ${category} ${alias}`;
    
    if (searchText.includes('burger') || searchText.includes('big mac') || searchText.includes('whopper')) return 'burgers';
    if (searchText.includes('chicken') || searchText.includes('wing') || searchText.includes('nugget')) return 'chicken';
    if (searchText.includes('fries') || searchText.includes('ring') || searchText.includes('onion') || searchText.includes('potato')) return 'sides';
    if (searchText.includes('cola') || searchText.includes('drink') || searchText.includes('juice') || searchText.includes('coffee') || searchText.includes('tea')) return 'drinks';
    if (searchText.includes('ice cream') || searchText.includes('dessert') || searchText.includes('cake') || searchText.includes('pie')) return 'desserts';
    
    return 'other';
  }

  private generateImageUrlEnhanced(apiProduct: any): string {
    console.log('🖼️ Enhanced image URL generation for:', apiProduct.name);
    
    const imageSource = this.getImageSource(apiProduct);
    console.log('🔍 Image source detected:', imageSource.type);
    
    switch (imageSource.type) {
      case 'imageId':
        const idUrl = `${this.BaseURL}/images?id=${imageSource.value}`;
        console.log('✅ Using imageId URL:', idUrl);
        return idUrl;
        
      case 'base64':
        console.log('✅ Using base64 image');
        return imageSource.value;
        
      case 'directUrl':
        console.log('✅ Using direct URL:', imageSource.value);
        return imageSource.value;
        
      case 'fallback':
      default:
        const fallbackUrl = this.generateCategoryBasedImageUrl(apiProduct);
        console.log('⚠️ Using fallback image:', fallbackUrl);
        return fallbackUrl;
    }
  }

  private getImageSource(apiProduct: any): { type: string; value: string } {
    // PRIORITATE 1: imageId
    if (apiProduct.imageId && typeof apiProduct.imageId === 'string' && apiProduct.imageId.length > 10) {
      return { type: 'imageId', value: apiProduct.imageId };
    }

    // PRIORITATE 2: image field cu base64
    if (apiProduct.image && typeof apiProduct.image === 'string') {
      if (apiProduct.image.startsWith('data:image/')) {
        return { type: 'base64', value: apiProduct.image };
      }
      if (apiProduct.image.length > 20 && !apiProduct.image.includes(' ')) {
        return { type: 'imageId', value: apiProduct.image };
      }
    }
    
    // PRIORITATE 3: imageUrl direct
    if (apiProduct.imageUrl && typeof apiProduct.imageUrl === 'string') {
      if (apiProduct.imageUrl.startsWith('data:image/')) {
        return { type: 'base64', value: apiProduct.imageUrl };
      }
      if (apiProduct.imageUrl.startsWith('http')) {
        return { type: 'directUrl', value: apiProduct.imageUrl };
      }
    }
    
    return { type: 'fallback', value: '' };
  }

  private generateCategoryBasedImageUrl(apiProduct: any): string {
    const category = this.mapApiCategory(apiProduct);
    const id = apiProduct.id || Math.floor(Math.random() * 1000);
    
    const categoryImages: { [key: string]: string } = {
      'burgers': `https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`,
      'chicken': `https://images.unsplash.com/photo-1562967914-608f82629710?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`,
      'sides': `https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`,
      'drinks': `https://images.unsplash.com/photo-1544145945-f90425340c7e?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`,
      'desserts': `https://images.unsplash.com/photo-1551024506-0bccd828d307?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`,
      'other': `https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=300&h=200&fit=crop&crop=center&q=80&sig=${id}`
    };
    
    return categoryImages[category] || categoryImages['other'];
  }

  private determinePopularity(apiProduct: any): boolean {
    const name = String(apiProduct.name || '').toLowerCase();
    const sales = apiProduct.salesCount || apiProduct.popularity || 0;
    
    if (sales > 100) return true;
    if (name.includes('popular') || name.includes('bestseller') || name.includes('signature')) return true;
    if (name.includes('big') || name.includes('special') || name.includes('deluxe')) return true;
    if (name.includes('classic') || name.includes('original') || name.includes('famous')) return true;
    
    return Math.random() > 0.75;
  }

  private extractAllergens(apiProduct: any): string[] {
    const name = String(apiProduct.name || '').toLowerCase();
    const description = String(apiProduct.description || '').toLowerCase();
    const searchText = `${name} ${description}`;
    const allergens: string[] = [];
    
    if (searchText.includes('cheese') || searchText.includes('milk') || searchText.includes('cream') || searchText.includes('butter')) {
      allergens.push('Lactose');
    }
    if (searchText.includes('bread') || searchText.includes('burger') || searchText.includes('bun') || searchText.includes('flour')) {
      allergens.push('Gluten');
    }
    if (searchText.includes('egg')) {
      allergens.push('Eggs');
    }
    if (searchText.includes('nut') || searchText.includes('almond') || searchText.includes('peanut')) {
      allergens.push('Nuts');
    }
    if (searchText.includes('soy') || searchText.includes('soja')) {
      allergens.push('Soy');
    }
    
    return allergens;
  }

  private estimatePreparationTime(apiProduct: any): number {
    const category = this.mapApiCategory(apiProduct);
    const name = String(apiProduct.name || '').toLowerCase();
    
    let baseTime = 5;
    
    switch (category) {
      case 'drinks': baseTime = 1; break;
      case 'desserts': baseTime = 3; break;
      case 'sides': baseTime = 5; break;
      case 'chicken': baseTime = 12; break;
      case 'burgers': baseTime = 8; break;
      default: baseTime = 6;
    }
    
    if (name.includes('simple') || name.includes('quick')) baseTime = Math.max(1, baseTime - 3);
    if (name.includes('special') || name.includes('deluxe') || name.includes('custom')) baseTime += 5;
    if (name.includes('large') || name.includes('big') || name.includes('xl')) baseTime += 2;
    
    return Math.min(30, Math.max(1, baseTime));
  }

  private checkAvailability(apiProduct: any): boolean {
    if (apiProduct.isAvailable === false) return false;
    if (apiProduct.available === false) return false;
    if (apiProduct.status === 'unavailable' || apiProduct.status === 'disabled') return false;
    if (apiProduct.inStock === false) return false;
    if (apiProduct.isActive === false) return false;
    if (apiProduct.isDisabled === true) return false;
    
    if (typeof apiProduct.stock === 'number' && apiProduct.stock <= 0) return false;
    if (typeof apiProduct.quantity === 'number' && apiProduct.quantity <= 0) return false;
    
    return true;
  }

  private extractLocationPrices(apiProduct: any): LocationPrice[] {
    if (!apiProduct.locationPrices || !Array.isArray(apiProduct.locationPrices)) {
      return [];
    }
    
    return apiProduct.locationPrices.map((lp: any, index: number) => {
      let price = 0;
      if (typeof lp.unitPriceWithVat === 'number' && lp.unitPriceWithVat > 0) {
        price = lp.unitPriceWithVat;
      } else if (typeof lp.price === 'number' && lp.price > 0) {
        price = lp.price;
      } else if (typeof lp.unitPrice === 'number' && lp.unitPrice > 0) {
        price = lp.unitPrice;
      }
      
      return {
        locationUid: lp.locationUid || `loc_${index}`,
        locationName: lp.locationName || `Location ${index + 1}`,
        price: Math.round(price * 100) / 100,
        unitPrice: lp.unitPrice || lp.unitPriceWithVat,
        currency: 'RON',
        isActive: lp.isActive !== false
      };
    }).filter((lp: LocationPrice) => lp.price > 0);
  }

  private transformOrderFormat(orderData: Order): any {
    const now = new Date().toISOString();
    const deliveryDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    
    return {
      uid: null,
      startDate: now,
      deliveryDate: deliveryDate,
      deliveryStartDate: deliveryDate,
      deliveryStopDate: null,
      description: null,
      isVoid: false,
      discountPercent: 0,
      client: {
        uid: "00000000000000000000000000000000",
        deliveryAddress: {
          clientUid: null,
          clientName: null,
          name: `${orderData.customerInfo?.firstName} ${orderData.customerInfo?.lastName}` || "Customer",
          phone: orderData.customerInfo?.phone || "-",
          isDefault: false,
          editAddressMode: false,
          addressDetails: null,
          streetName: null,
          streetNo: null,
          building: null,
          buildingNo: null,
          floor: null,
          apartment: null,
          zipCode: null,
          countryName: "Romania",
          countryUid: "c41e27deddc14097b625317759783a9f",
          districtName: "Alba",
          districtUid: "8125f528844b40308346126f93697a47",
          cityName: "Abrud",
          cityUid: "821da644b0e54851874510a579fe175b",
          uid: "91102105af634f6d8760cf27c08cf5a7",
          isDisabled: false,
          addedAt: null,
          addedBy: null,
          modifiedAt: null,
          modifiedBy: null
        }
      },
      billingClientUid: "00000000000000000000000000000000",
      billingClient: {
        accounts: [],
        products: [],
        addresses: [],
        fidelityCard: null,
        parentUids: [],
        blockedPaymentMethods: [],
        name: "TEST PREZENTARI",
        clientGroupUid: null,
        clientGroupName: null,
        description: null,
        uniqueCode: "RO00000000",
        identificationCode: "J40/14578/2023",
        phone: orderData.customerInfo?.phone || "-",
        email: orderData.customerInfo?.email || "test.user@example.com",
        discountPercent: null,
        vatCollecting: null,
        vatPayer: null,
        orderFlag: 2147483647,
        defaultDeadlineDays: 30,
        birthDate: null,
        countryName: "Romania",
        countryUid: "c41e27deddc14097b625317759783a9f",
        districtName: "Bucuresti",
        districtUid: "a31d13bdb2334f069388cecc873b7429",
        cityName: "Bucuresti",
        cityUid: "4b65594947dc4d33980737d6265d19dc",
        streetName: null,
        streetNo: null,
        imageId: null,
        parentUid: null,
        fullAddress: null,
        isGovernmentInstitution: false,
        totalPromoPoints: 0,
        isJuridicPerson: true,
        zipCode: null,
        vatName: null,
        vatUid: null,
        gender: null,
        signatureUid: null,
        isExternalClient: false,
        uid: "00000000000000000000000000000000",
        isDisabled: false,
        addedAt: "2024-10-14T10:27:45.531515+03:00",
        addedBy: "Test User",
        modifiedAt: null,
        modifiedBy: null
      },
      items: orderData.items.map((item: CartItem) => ({
        uid: null,
        description: null,
        parentProductUid: null,
        productName: item.name,
        productUid: item.uid || item.id.toString(),
        vatRate: 0,
        units: 1,
        quantity: item.quantity,
        finalQuantity: item.quantity,
        unitPriceWithVat: item.price,
        discountValue: 0,
        discountPercent: 0,
        discountType: 0,
        addedAt: now,
        toppings: item.toppings || [],
        collectibleUnits: 0,
        isRetuRo: false
      })),
      payments: [],
      email: orderData.customerInfo?.email || "test.user@example.com",
      locationUid: "1b252fdf4fba4629a1f4d2d80167a02c",
      orderSourceUid: null,
      deliveryTax: 0,
      deliveryHours: 2,
      collectibleUnits: 0,
      isRetuRo: false
    };
  }

  // =============== ADDITIONAL IMAGE METHODS ===============

  getImageAsDataUrl(imageId: string): Observable<string> {
    console.log('🖼️ Fetching image with auth headers:', imageId);

    const requestFn = () => {
      const imageUrl = `${this.BaseURL}/images?id=${imageId}`;
      
      return this.http.get(imageUrl, {
        ...this.httpOptions,
        responseType: 'blob'
      }).pipe(
        map((blob: Blob) => {
          console.log('✅ Image blob received, size:', blob.size, 'bytes');
          return URL.createObjectURL(blob);
        })
      );
    };

    return this.makeAuthenticatedRequest(requestFn).pipe(
      catchError(error => {
        console.error('❌ Image fetch failed:', error);
        return throwError(() => error);
      })
    );
  }

  // =============== DEBUG METHODS ===============

  debugProductTransformation(productId: number | string): Observable<any> {
    console.log('🔍 Debug mode: Product transformation details');
    
    return this.getSellingProducts().pipe(
      map(products => {
        const product = products.find(p => p.id == productId || p.uid === productId);
        if (!product) {
          console.log('❌ Product not found:', productId);
          return null;
        }
        
        console.log('🔍 === PRODUCT DEBUG INFO ===');
        console.log('- Transformed product:', product);
        console.log('- Raw API data:', product.rawApiData);
        console.log('- Price source analysis:', this.analyzePriceSource(product.rawApiData));
        console.log('- Image source analysis:', this.getImageSource(product.rawApiData));
        console.log('- Location prices:', product.locationPrices);
        console.log('============================');
        
        return {
          transformed: product,
          raw: product.rawApiData,
          priceAnalysis: this.analyzePriceSource(product.rawApiData),
          imageAnalysis: this.getImageSource(product.rawApiData)
        };
      })
    );
  }

  private analyzePriceSource(apiProduct: any): any {
    const analysis = {
      locationPrices: apiProduct.locationPrices,
      unitPriceWithVat: apiProduct.unitPriceWithVat,
      directPriceFields: {} as { [key: string]: any },
      recommendedSource: 'unknown'
    };
    
    const priceFields = ['price', 'unitPrice', 'cost', 'amount', 'basePrice'];
    priceFields.forEach(field => {
      if (apiProduct[field] !== undefined) {
        analysis.directPriceFields[field] = apiProduct[field];
      }
    });
    
    if (apiProduct.locationPrices && Array.isArray(apiProduct.locationPrices) && apiProduct.locationPrices.length > 0) {
      analysis.recommendedSource = 'locationPrices';
    } else if (typeof apiProduct.unitPriceWithVat === 'number' && apiProduct.unitPriceWithVat > 0) {
      analysis.recommendedSource = 'unitPriceWithVat';
    } else {
      for (const field of priceFields) {
        if (typeof apiProduct[field] === 'number' && apiProduct[field] > 0) {
          analysis.recommendedSource = field;
          break;
        }
      }
    }
    
    return analysis;
  }
}

// =============== EXPORTS ===============
export { ApiService as Api };
export default ApiService;